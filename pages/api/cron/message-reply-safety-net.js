/**
 * GET /api/cron/message-reply-safety-net
 * Vercel Cron Job — runs every 30 minutes.
 *
 * EM-11 ("Team Replied to Your Message") is sent from exactly one place —
 * pages/api/monday/update-webhook.js — and that depends entirely on a
 * Monday automation ("When an update is created -> send a webhook") staying
 * registered on the board. That automation has already been found disabled/
 * missing once before with nothing noticing until Bryan happened to check
 * (see OPEN-3's resolution history in Customer-Portal-Process-Flow.md).
 * This is the backstop for that exact single point of failure, built the
 * same way cron/invite-safety-net.js handles its own analogous gap: it does
 * NOT send the missing customer email itself — silently emailing a customer
 * from a best-effort sweep, possibly re-sending for a reply that WAS
 * actually notified through a path this cron doesn't know about, is a worse
 * failure mode than a delayed human catching a real gap — it only finds
 * orders that look like a staff reply went un-notified and puts a human on
 * it via the same internal-alert mechanism (lib/monitoring.js) every other
 * "must not fail silently" case in this codebase already uses.
 *
 * A "gap" is an order whose most recent staff reply (Messages-tab chat
 * tagged [PORTAL:STAFF], or an untagged reply from a staff email typed
 * directly into Monday's Updates feed — same classification
 * update-webhook.js itself uses to decide whether to notify) is:
 *   - older than GRACE_PERIOD_MINUTES (gives the real-time webhook a chance
 *     to fire before this flags anything), AND
 *   - newer than the most recent "[PORTAL: Reply Notified]" marker
 *     update-webhook.js posts on every successful send (or there's no such
 *     marker at all yet).
 *
 * Message Status (order.messageStatus) is checked first as a cheap filter —
 * it only ever reaches "Replied" via a staff reply, so an order that's
 * never been replied to (blank, or still "Needs Reply") can skip the full
 * message-history fetch entirely.
 */

import { getAllOrders, getOrderMessages } from '../../../lib/monday';
import { isPortalChatMessage, isStaffMessage } from '../../../lib/messageOrigin';
import { isStaffEmail } from '../../../lib/auth';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';

const GRACE_PERIOD_MINUTES = 30;
const CHECK_CONCURRENCY = 8;

// Mirrors update-webhook.js's own trigger classification (see that file's
// PORTAL-031 comment) so this can't silently drift from what actually
// counts as a notifiable staff reply there.
function isNotifiableStaffReply(update) {
  const body = update.body || '';
  if (isPortalChatMessage(update)) return isStaffMessage(update);
  if (/^\[PORTAL:/.test(body)) return false; // this app's own audit-trail tags, never a reply
  return isStaffEmail(update.creator?.email);
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // Same fail-closed discipline as every other cron in this app (PORTAL-033).
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const results = { checked: 0, gaps: 0, skipped: 0, errors: 0 };
  const flagged = [];

  try {
    const orders = await getAllOrders();
    const withEmail = orders.filter(o => o.customerEmail);
    results.checked = withEmail.length;

    await mapWithConcurrency(withEmail, CHECK_CONCURRENCY, async (order) => {
      try {
        if (order.messageStatus !== 'Replied') { results.skipped++; return; }

        const updates = await getOrderMessages(order.id);
        const sorted = [...updates].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        const lastStaffReply = [...sorted].reverse().find(isNotifiableStaffReply);
        if (!lastStaffReply) { results.skipped++; return; }

        const replyAgeMinutes = (now - new Date(lastStaffReply.created_at)) / (1000 * 60);
        if (replyAgeMinutes < GRACE_PERIOD_MINUTES) { results.skipped++; return; }

        const lastNotified = [...sorted].reverse().find(u => (u.body || '').startsWith('[PORTAL: Reply Notified]'));
        if (lastNotified && new Date(lastNotified.created_at) > new Date(lastStaffReply.created_at)) {
          results.skipped++; return;
        }

        results.gaps++;
        flagged.push({
          id: order.id,
          name: order.name,
          customerEmail: order.customerEmail,
          replyAt: lastStaffReply.created_at,
        });
      } catch (orderErr) {
        console.error(`Message-reply safety-net check error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    });

    if (flagged.length > 0) {
      const lines = flagged
        .map(o => `- ${o.name} (id ${o.id}) — staff replied ${new Date(o.replyAt).toLocaleString()}, ${o.customerEmail} was never emailed about it`)
        .join('\n');
      await reportCriticalFailure(
        'cron/message-reply-safety-net',
        `${flagged.length} order(s) have a staff reply more than ${GRACE_PERIOD_MINUTES} minutes old with no "reply notified" email logged. The Monday "when an update is created" automation (update-webhook.js) may be disabled or misconfigured again — check Monday's automation log, and manually follow up with these customers in the meantime.`,
        { orders: lines }
      );
    }

    console.log(`Cron message-reply-safety-net summary: checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}`);

    return res.status(200).json({ ok: true, ...results, flagged });
  } catch (err) {
    console.error(`Cron message-reply-safety-net FAILED before completing (checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}):`, err);
    await reportCriticalFailure(
      'cron/message-reply-safety-net',
      `Message-reply safety-net cron run failed before completing (checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}).`,
      { error: err.message }
    );
    return res.status(500).json({ error: 'Cron job failed.', ...results });
  }
}
