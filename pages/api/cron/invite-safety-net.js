/**
 * GET /api/cron/invite-safety-net
 * Vercel Cron Job — runs every 6 hours.
 *
 * Direct requirement from Bryan (2026-09-11): the customer portal invite is
 * the one thing that starts the entire customer-facing setup process — if
 * it's never sent, the customer never even knows the portal exists, and
 * Summit ends up silently waiting on delivery/billing/color information the
 * customer was never actually asked for. The invite is triggered by staff
 * flipping "Customer Portal Invite" to "Send Invite", or by the Monday
 * automation when "Manufacturing Phase" changes to "Incoming Order" (see
 * pages/api/monday/invite-webhook.js). Neither is proven un-droppable, so
 * this backstop finds orders that should have an invite by now and don't,
 * and alerts the team. It never sends an invite itself.
 *
 * Paused 2026-09-18 (PORTAL-058) after its first run flagged 263 of 378
 * orders: nearly all were orders from before the portal existed, plus
 * pre-sales/administrative phases. Re-enabled 2026-10-06 with:
 *   - only orders created on or after ORDERS_CREATED_SINCE (Bryan: "today's
 *     date"), so historical orders are never considered;
 *   - phases that aren't a live customer order (SKIP_PHASES) skipped;
 *   - "Do Not Send" on Customer Portal Invite, and test orders on a staff
 *     address, skipped;
 *   - one alert per order (the first run after its grace period), then once
 *     a day at most — not every run forever.
 */

import { getOrderSummaries, getOrderMessages } from '../../../lib/monday';
import { isStaffEmail, secretsMatch } from '../../../lib/auth';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';

// Midnight Mountain on the day this was re-enabled.
export const ORDERS_CREATED_SINCE = new Date('2026-10-06T06:00:00Z');
const GRACE_PERIOD_HOURS = 6;
const CRON_INTERVAL_HOURS = 6;
const DAILY_REMINDER_UTC_HOUR = 12; // the 12:00 UTC run (6am Mountain)
const CHECK_CONCURRENCY = 8;

// Real "Manufacturing Phase" labels that don't mean "a customer order the
// portal should be running for" (pre-sales hold, cancelled, nothing to do).
const SKIP_PHASES = new Set(['Wait to Push Order', 'ORDER CANCELLED', 'No Action Needed']);

/** Should this order be checked for a missing invitation at all? */
export function needsInviteCheck(order, now) {
  if (!order.customerEmail || isStaffEmail(order.customerEmail)) return false;
  const phase = (order.status || '').trim();
  if (!phase || SKIP_PHASES.has(phase)) return false;
  if ((order.inviteStatus || '').trim() === 'Do Not Send') return false;
  const created = new Date(order.createdAt || now);
  if (created < ORDERS_CREATED_SINCE) return false;
  return (now - created) / 3600000 >= GRACE_PERIOD_HOURS;
}

/** Alert on the first run that sees the gap, then only on the daily run. */
export function shouldAlertInviteGap(order, now) {
  const ageHours = (now - new Date(order.createdAt)) / 3600000;
  if (ageHours < GRACE_PERIOD_HOURS + CRON_INTERVAL_HOURS) return true;
  return now.getUTCHours() === DAILY_REMINDER_UTC_HOUR;
}

// Vercel kills a run at the function's time limit with no summary log or
// alert; declare the ceiling explicitly (Pro plan max) — audit 2026-10-09.
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // Same fail-closed discipline as every other cron in this app (PORTAL-033)
  // — an unset CRON_SECRET rejects rather than accepting "Bearer undefined".
  if (!process.env.CRON_SECRET || !secretsMatch(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('Invite safety-net cron: run started');

  const now = new Date();
  const results = { checked: 0, gaps: 0, skipped: 0, errors: 0 };
  const flagged = [];

  try {
    // Light read (a few columns, no subitems) — getAllOrders() has timed
    // out on this board.
    const orders = await getOrderSummaries();
    const candidates = orders.filter(o => needsInviteCheck(o, now));
    results.checked = candidates.length;
    results.skipped = orders.length - candidates.length;

    await mapWithConcurrency(candidates, CHECK_CONCURRENCY, async (order) => {
      try {
        const updates = await getOrderMessages(order.id);
        // "Invitation Sent" is also posted on a customer's other orders when
        // one invite covers them all (invite-webhook.js).
        const hasInvite = updates.some(u => (u.body || '').includes('[PORTAL: Invitation Sent]'));
        if (hasInvite) { results.skipped++; return; }

        results.gaps++;
        flagged.push({ ...order, alert: shouldAlertInviteGap(order, now) });
      } catch (orderErr) {
        console.error(`Invite safety-net check error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    });

    const toAlert = flagged.filter(o => o.alert);
    if (toAlert.length > 0) {
      const lines = toAlert
        .map(o => `- ${o.name} (id ${o.id}, phase "${o.status}", created ${new Date(o.createdAt).toLocaleDateString()}) — ${o.customerEmail}`)
        .join('\n');
      await reportCriticalFailure(
        'cron/invite-safety-net',
        `${toAlert.length} order(s) created since ${ORDERS_CREATED_SINCE.toLocaleDateString()} have a customer email and a live Manufacturing Phase, are more than ${GRACE_PERIOD_HOURS}h old, but were never sent a portal invitation. Set "Customer Portal Invite" to "Send Invite" (or "Do Not Send" if they shouldn't get one). Each order is re-alerted at most once a day.`,
        { orders: lines }
      );
    }

    console.log(`Cron invite-safety-net summary: checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}`);

    return res.status(200).json({ ok: true, ...results, flagged });
  } catch (err) {
    console.error(`Cron invite-safety-net FAILED before completing (checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}):`, err);
    await reportCriticalFailure(
      'cron/invite-safety-net',
      `Invite safety-net cron run failed before completing (checked=${results.checked} gaps=${results.gaps} skipped=${results.skipped} errors=${results.errors}).`,
      { error: err.message }
    );
    return res.status(500).json({ error: 'Cron job failed.', ...results });
  }
}
