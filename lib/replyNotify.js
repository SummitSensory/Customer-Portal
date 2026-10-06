/**
 * EM-11 ("Summit Sensory Gym replied to your message"): the one place that
 * decides which staff messages a customer gets emailed about, and the one
 * place that sends it. Used by the Admin Portal reply path (messages.js), the
 * Monday "update created" webhook (update-webhook.js), and the 30-minute
 * backstop (cron/message-reply-safety-net.js).
 *
 * Only messages the customer can actually SEE in their portal count — the
 * Messages tab (pages/portal/index.js) shows `[PORTAL]` chat posts and the
 * threaded replies under them, nothing else. So a notifiable staff message is
 * either:
 *   - a `[PORTAL][PORTAL:STAFF]` chat post (sent from the Admin Portal), or
 *   - a staff reply threaded under a `[PORTAL]` chat post (typed in Monday).
 * Before 2026-10-06 the webhook emailed ANY untagged top-level update a staff
 * account typed on the order — internal notes included, which the customer
 * couldn't even see in the portal.
 *
 * Dedupe is by message id: every send posts a "[PORTAL: Reply Notified]"
 * marker listing the ids it covered (`message 123` / `reply 456`). That makes
 * the webhook, the Admin Portal path and the cron safe to overlap, and a
 * second reply posted seconds after the first is still notified (the old
 * timestamp comparison treated it as already covered).
 */

import { getOrderById, getOrderMessages, postTaggedUpdate, setStatusLabel } from './monday';
import { sendCustomerReplyNotification } from './email';
import { isPortalChatMessage, isStaffMessage, isStaffReply, stripPortalTags } from './messageOrigin';

export const REPLY_MARKER_TAG = 'PORTAL: Reply Notified';

// Markers before this carried no ids. Anything older was handled by the old
// timestamp logic (or predates markers entirely), so it's never re-sent.
export const ID_MARKERS_SINCE = new Date('2026-10-06T16:00:00Z');

// Admin Portal posts are emailed by messages.js the moment they're sent; the
// webhook and cron leave them alone for this long so the two never race.
export const ADMIN_POST_GRACE_MS = 10 * 60 * 1000;

const MARKER_ID_RE = /\b(?:message|reply) (\d+)/g;

// Ids covered by id-style markers, plus the time of the newest old-style
// marker (no ids) — those covered everything posted before them.
function notifiedState(updates) {
  const ids = new Set();
  let legacyCoveredUntil = 0;
  for (const u of updates) {
    const body = u.body || '';
    if (!body.startsWith(`[${REPLY_MARKER_TAG}]`)) continue;
    const found = [...body.matchAll(MARKER_ID_RE)].map(m => m[1]);
    if (found.length) found.forEach(id => ids.add(id));
    else legacyCoveredUntil = Math.max(legacyCoveredUntil, new Date(u.created_at).getTime());
  }
  return { ids, legacyCoveredUntil };
}

/**
 * Staff messages visible to the customer that haven't been emailed yet,
 * oldest first. Admin Portal posts younger than ADMIN_POST_GRACE_MS are
 * skipped unless includeFreshAdminPosts (messages.js passes it for its own
 * post).
 */
export function findUnnotifiedStaffMessages(updates, { now = new Date(), includeFreshAdminPosts = false } = {}) {
  const { ids: done, legacyCoveredUntil } = notifiedState(updates);
  const pending = [];
  for (const msg of updates) {
    if (!isPortalChatMessage(msg)) continue;
    if (isStaffMessage(msg)) {
      const fresh = now - new Date(msg.created_at) < ADMIN_POST_GRACE_MS;
      if (!fresh || includeFreshAdminPosts) pending.push({ kind: 'message', ...msg });
    }
    for (const reply of msg.replies || []) {
      if (isStaffReply(reply)) pending.push({ kind: 'reply', ...reply });
    }
  }
  return pending
    .filter(m => new Date(m.created_at) >= ID_MARKERS_SINCE
      && new Date(m.created_at).getTime() > legacyCoveredUntil
      && !done.has(String(m.id)))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function previewText(body) {
  return stripPortalTags(body || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

/**
 * Email the customer about any visible staff message they haven't been told
 * about yet, then post the id marker. Throws if the send fails (nothing is
 * marked, so the next webhook or cron run retries). Returns { sent, ids }.
 */
export async function notifyPendingStaffReplies(itemId, { now = new Date(), includeFreshAdminPosts = false, updates = null } = {}) {
  const history = updates || await getOrderMessages(itemId);
  const pending = findUnnotifiedStaffMessages(history, { now, includeFreshAdminPosts });
  if (!pending.length) return { sent: false, ids: [] };

  const order = await getOrderById(itemId);
  if (!order?.customerEmail) return { sent: false, ids: [], skipped: 'No customer email on order.' };

  const latest = pending[pending.length - 1];
  // An image-only or attachment-only reply strips to nothing; still worth an
  // email (it used to be skipped, leaving a gap the cron could never clear).
  const preview = previewText(latest.body) || 'You have a new message from our team in your portal.';

  await sendCustomerReplyNotification(
    order.customerEmail,
    order.firstName || order.pocName?.split(' ')[0] || '',
    order.name,
    preview
  );

  const ids = pending.map(m => `${m.kind} ${m.id}`);
  await postTaggedUpdate(
    itemId,
    REPLY_MARKER_TAG,
    `Staff reply notification emailed to ${order.customerEmail} on ${now.toLocaleDateString()} (${ids.join(', ')}).`
  ).catch(err => console.error(`Reply notification sent to ${order.customerEmail}, but the "[${REPLY_MARKER_TAG}]" marker write FAILED for order ${itemId} — the next run may email them again:`, err.message));
  await setStatusLabel(itemId, 'messageStatus', 'Replied').catch(() => {});

  return { sent: true, ids, customerEmail: order.customerEmail, oldestAt: pending[0].created_at };
}
