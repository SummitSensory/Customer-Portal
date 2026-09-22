/**
 * POST /api/monday/update-webhook
 * Receives Monday.com automation webhook when a new update (reply) is posted
 * on an order item. If the reply is from a Summit staff member, emails the
 * customer to let them know there's a new message in their portal.
 *
 * Monday.com automation setup:
 *   Trigger: "When an update is created"
 *   Action:  "Send a webhook" → https://your-domain.vercel.app/api/monday/update-webhook?secret=<MONDAY_UPDATE_WEBHOOK_SECRET>
 *   JSON body: { "itemId": "{itemId}", "updateBody": "{updateBody}", "creatorEmail": "{creatorEmail}" }
 *
 * The automation fires for ALL updates (including customer ones). We only
 * email the customer when the update comes from a staff email domain.
 *
 * PORTAL-003: this endpoint previously had no authentication of any kind —
 * anyone who discovered the URL could POST an arbitrary itemId/creatorEmail
 * and trigger a customer notification email (or probe which itemIds exist
 * via the response). It now requires the same shared-secret query param
 * pattern used by accessory-webhook.js, and fails CLOSED if the secret env
 * var isn't configured.
 */

import { getOrderById, getOrderByEmail, getOrderMessages, setStatusLabel, postTaggedUpdate } from '../../../lib/monday';
import { sendCustomerReplyNotification } from '../../../lib/email';
import { isStaffEmail, secretsMatch } from '../../../lib/auth';
import { isPortalChatMessage, isStaffMessage } from '../../../lib/messageOrigin';

/**
 * PORTAL-064: this endpoint had no redelivery/idempotency guard at all —
 * unlike every other frequently-retried webhook in this codebase
 * (accessory-webhook.js, status-balance-webhook.js via
 * hasNotifiedValue()/markNotifiedValue()), it only ever posted its
 * "[PORTAL: Reply Notified]" tag AFTER successfully sending, never checked
 * for one BEFORE. A Monday retry of the same "update created" event (a slow
 * or ambiguous response, a timeout on our end after the email already went
 * out) re-sends EM-11 for the same staff reply.
 *
 * The webhook payload carries no unique event/update id — just itemId,
 * updateBody, and creatorEmail (see this file's own setup comment) — so
 * there's no simple "have I seen this event id" check available the way
 * hasNotifiedValue()'s kind+value tag works elsewhere. What IS reliable:
 * this exact reply already exists in the order's own update history (it's
 * what triggered the webhook), so its real created_at can be looked up
 * there, and then checked against whether a "[PORTAL: Reply Notified]" tag
 * already exists at or after that moment — the same age comparison
 * cron/message-reply-safety-net.js already does from the other direction
 * (see that file's own header comment). Deliberately keeps posting the tag
 * with the exact same literal text ("PORTAL: Reply Notified", no suffix)
 * that safety-net cron matches via `startsWith('[PORTAL: Reply Notified]')`
 * — changing that format would silently break that cron's own dedupe logic,
 * and that file is out of scope for this fix.
 *
 * If the triggering reply can't be found yet (e.g. a brief Monday
 * read-after-write lag right after it was posted), this fails toward
 * sending rather than silently dropping a real notification — an occasional
 * duplicate is a known, disclosed tradeoff; a customer reply nobody was ever
 * told about is the worse failure this whole endpoint exists to prevent.
 */
async function alreadyNotifiedThisReply(itemId, updateBody, creatorEmail) {
  const updates = await getOrderMessages(itemId);
  const sorted = [...updates].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const thisReply = [...sorted].reverse().find(u =>
    (u.body || '') === (updateBody || '') &&
    (u.creator?.email || '').toLowerCase() === (creatorEmail || '').toLowerCase()
  );
  if (!thisReply) return false;
  return sorted.some(u =>
    (u.body || '').startsWith('[PORTAL: Reply Notified]') &&
    new Date(u.created_at) >= new Date(thisReply.created_at)
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday.com sends a challenge on first setup — respond to verify
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Fails CLOSED: if the secret isn't configured, reject rather than accept
  // unauthenticated requests. Mirrors accessory-webhook.js.
  const secret = process.env.MONDAY_UPDATE_WEBHOOK_SECRET;
  if (!secretsMatch(req.query.secret, secret)) {
    console.error('Monday update-webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid secret.' });
  }

  const { itemId, updateBody, creatorEmail } = req.body || {};
  if (!itemId || !creatorEmail) return res.status(400).json({ error: 'Missing fields.' });

  // PORTAL-031: Monday's "when an update is created" automation fires for
  // EVERY update on the item, including ones this app itself posted via the
  // API — real customer chat (postOrderMessage) and every automated
  // audit-trail tag (postTaggedUpdate: color-selection confirmations,
  // contact-info changes, referrals, reminders, impersonation logs, etc.).
  // Monday's create_update API always attributes an API-created update to
  // whoever owns MONDAY_API_TOKEN, never the real sender (see
  // lib/messageOrigin.js's header) — so creatorEmail on ANY of those looks
  // exactly like a staff reply. Using isStaffEmail(creatorEmail) alone meant
  // a customer's own portal message (or a routine automated log) flipped
  // "Needs Reply" straight back to "Replied" the instant it was posted, and
  // triggered a "new message from Summit Sensory Gym" email that just
  // echoed the customer's own text or an internal log back at them.
  //
  // Tag-based first, exactly like messageOrigin.js's own read-side logic:
  //   - A real Messages-tab post starts with the literal "[PORTAL]" prefix
  //     (see /api/monday/messages.js) — trust its explicit
  //     [PORTAL:STAFF]/[PORTAL:CUSTOMER] tag instead of creatorEmail.
  //   - One of this app's own automated tags starts "[PORTAL: ...]"
  //     (postTaggedUpdate) — never a real reply, never worth notifying the
  //     customer about.
  //   - Only a genuinely untagged update — staff replying directly inside
  //     Monday, not through this app — falls back to creatorEmail, which is
  //     trustworthy in that one case (see isStaffReply's own reasoning).
  let isStaff;
  if (isPortalChatMessage({ body: updateBody })) {
    isStaff = isStaffMessage({ body: updateBody });
  } else if (/^\[PORTAL:/.test(updateBody || '')) {
    isStaff = false;
  } else {
    isStaff = isStaffEmail(creatorEmail);
  }
  if (!isStaff) return res.status(200).json({ skipped: 'Non-staff update, no notification sent.' });

  try {
    // PORTAL-064: check BEFORE acting, not just after — see this file's own
    // header comment on alreadyNotifiedThisReply for why.
    if (await alreadyNotifiedThisReply(itemId, updateBody, creatorEmail)) {
      return res.status(200).json({ ok: true, skipped: 'Already notified for this reply (redelivery).' });
    }

    // Staff replied — clear the messaging queue flag regardless of whether the
    // update was on-topic (a message reply) or something else staff-only; keeps
    // the "Message Status" column from getting stuck on "Needs Reply" if staff
    // reply to something unrelated to the portal Messages thread.
    await setStatusLabel(itemId, 'messageStatus', 'Replied').catch(() => {});

    const order = await getOrderById(itemId);
    if (!order?.customerEmail) return res.status(200).json({ skipped: 'No customer email on order.' });

    // Strip HTML and internal portal tags from the email preview
    const preview = (updateBody || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[PORTAL:[^\]]*\]/g, '') // remove [PORTAL: X] completion tags
      .replace(/^\[PORTAL\]\n?/m, '')    // remove bare [PORTAL] message prefix
      .trim()
      .slice(0, 280);

    if (!preview) return res.status(200).json({ skipped: 'Empty update body.' });

    await sendCustomerReplyNotification(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name,
      preview
    );

    // Marker for cron/message-reply-safety-net.js: this is the ONLY place
    // EM-11 gets sent from, entirely dependent on the Monday "when an update
    // is created" automation staying registered on this board (see OPEN-3's
    // resolution history — it's been disabled/misconfigured before). The
    // safety-net cron compares the timestamp of this tag against the
    // timestamp of the most recent staff reply to spot a gap; a failure to
    // log it is non-fatal to this request (the customer already got their
    // email) but is loud so it isn't silently invisible either.
    await postTaggedUpdate(
      itemId,
      'PORTAL: Reply Notified',
      `Staff reply notification emailed to ${order.customerEmail} on ${new Date().toLocaleDateString()}.`
    ).catch(err => console.error(`Reply notification sent to ${order.customerEmail}, but the "[PORTAL: Reply Notified]" log write FAILED for order ${itemId} — cron/message-reply-safety-net may falsely flag this as a gap:`, err.message));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Update webhook error:', err);
    return res.status(500).json({ error: 'Notification failed.' });
  }
}
