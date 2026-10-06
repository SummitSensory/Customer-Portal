/**
 * GET /api/cron/message-reply-safety-net
 * Vercel Cron Job — runs every 30 minutes.
 *
 * Backstop for EM-11 ("Summit Sensory Gym replied to your message"). The
 * email normally goes out the moment staff reply — from messages.js for
 * Admin Portal replies, from update-webhook.js for replies typed in Monday —
 * but the Monday webhook has been deactivated or misconfigured twice
 * (2026-08-18 → 10-05), and Monday may not fire "update created" for a
 * threaded reply at all. So every 30 minutes this re-checks every order with
 * a conversation and SENDS any visible staff reply the customer wasn't told
 * about, using the same lib/replyNotify.js logic and id-based markers as the
 * real-time paths (so nothing is ever emailed twice).
 *
 * It used to only alert the team, every run, forever: one stuck reply
 * (Dallas Center Grimes CSD, 2026-10-02 → 10-05) produced 153 identical
 * alerts while the customer waited three days. Now the team is alerted only
 * when a send itself fails — once on first failure, then once a day.
 */

import { getOrderSummaries, getOrderMessages } from '../../../lib/monday';
import { findUnnotifiedStaffMessages, notifyPendingStaffReplies } from '../../../lib/replyNotify';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';

const CHECK_CONCURRENCY = 8;
const CRON_INTERVAL_MINUTES = 30;
const DAILY_REMINDER_UTC_HOUR = 14; // 8am Mountain (MDT), same hour reminders.js runs

// Stateless alert cooldown for a send that keeps failing: alert on the first
// run that sees it, then only on the daily reminder run.
export function shouldAlertGap(ageMinutes, now) {
  if (ageMinutes < CRON_INTERVAL_MINUTES * 2) return true;
  return now.getUTCHours() === DAILY_REMINDER_UTC_HOUR && now.getUTCMinutes() < CRON_INTERVAL_MINUTES;
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // Same fail-closed discipline as every other cron in this app (PORTAL-033).
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const results = { checked: 0, sent: 0, failed: 0, errors: 0 };
  const sent = [];
  const failed = [];

  try {
    // Only email + Message Status are read here — the full order load is
    // far heavier and was timing out on Monday (2026-09-28). Any order with a
    // conversation has a Message Status ("Needs Reply" / "Replied"); checking
    // only "Replied" missed exactly the case where the webhook never fired.
    const orders = await getOrderSummaries();
    const withChat = orders.filter(o => o.customerEmail && o.messageStatus);
    results.checked = withChat.length;

    await mapWithConcurrency(withChat, CHECK_CONCURRENCY, async (order) => {
      let pending = [];
      try {
        const updates = await getOrderMessages(order.id);
        pending = findUnnotifiedStaffMessages(updates, { now });
        if (!pending.length) return;
        const result = await notifyPendingStaffReplies(order.id, { now, updates });
        if (result.sent) {
          results.sent++;
          sent.push({ id: order.id, name: order.name, ids: result.ids });
        }
      } catch (err) {
        if (!pending.length) {
          console.error(`Message-reply safety-net check error for order ${order.id}:`, err);
          results.errors++;
          return;
        }
        results.failed++;
        const ageMinutes = (now - new Date(pending[0].created_at)) / 60000;
        failed.push({ id: order.id, name: order.name, customerEmail: order.customerEmail, replyAt: pending[0].created_at, error: err.message, alert: shouldAlertGap(ageMinutes, now) });
      }
    });

    const toAlert = failed.filter(o => o.alert);
    if (toAlert.length > 0) {
      const lines = toAlert
        .map(o => `- ${o.name} (id ${o.id}) — staff replied ${new Date(o.replyAt).toLocaleString()}; emailing ${o.customerEmail} failed: ${o.error}`)
        .join('\n');
      await reportCriticalFailure(
        'cron/message-reply-safety-net',
        `${toAlert.length} order(s) have a staff reply the customer hasn't been emailed about, and sending the notification failed. It is retried every 30 minutes; please follow up with these customers directly. (Each order is re-alerted once a day while it keeps failing.)`,
        { orders: lines }
      );
    }

    console.log(`Cron message-reply-safety-net summary: checked=${results.checked} sent=${results.sent} failed=${results.failed} errors=${results.errors}`);
    return res.status(200).json({ ok: true, ...results, sent, failed });
  } catch (err) {
    console.error(`Cron message-reply-safety-net FAILED before completing (checked=${results.checked} sent=${results.sent} failed=${results.failed} errors=${results.errors}):`, err);
    await reportCriticalFailure(
      'cron/message-reply-safety-net',
      `Message-reply safety-net cron run failed before completing (checked=${results.checked} sent=${results.sent}).`,
      { error: err.message }
    );
    return res.status(500).json({ error: 'Cron job failed.', ...results });
  }
}
