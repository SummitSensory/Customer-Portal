/**
 * GET /api/cron/invite-safety-net
 * Vercel Cron Job — runs every 6 hours.
 *
 * PORTAL-058 — PAUSED 2026-09-18 (removed from vercel.json's crons list,
 * endpoint itself left intact): its first real run flagged 263 of 378 orders
 * on the board — an obvious false-positive flood, not 263 real gaps. Root
 * cause: the "has a real Manufacturing Phase value set at all" check below
 * treats ANY non-blank status as "should have an invite by now," but the
 * real statuses seen in that run include values like "Wait to Push Order,"
 * "No Action Needed," and "GB Fab Details Sent" — pre-sales/administrative
 * pipeline stages on this same shared board, not confirmed customer orders
 * past the "Incoming Order" trigger point this cron's own header describes.
 * STATUS_STAGES (lib/monday.js) only documents 5 labels; the real Manufacturing
 * Phase column clearly has many more, undocumented here — the exact class of
 * "verify against the real Monday column values first" mistake CLAUDE.md
 * warns about. Needs the real, complete list of Manufacturing Phase values
 * (and which ones actually follow "Incoming Order" in the pipeline) before
 * this can be fixed correctly — do not re-enable by guessing at a whitelist.
 *
 * Direct requirement from Bryan (2026-09-11): the customer portal invite is
 * the one thing that starts the entire customer-facing setup process — if
 * it's never sent, the customer never even knows the portal exists, and
 * Summit ends up silently waiting on delivery/billing/color information the
 * customer was never actually asked for. Today that invite is triggered
 * either by a staff member manually flipping "Customer Portal Invite" to
 * "Send Invite", or (per Bryan's separate, Monday-side automation — see
 * pages/api/monday/invite-webhook.js's own header) automatically once
 * "Manufacturing Phase" changes to "Incoming Order". Both are real triggers,
 * but neither is proven un-droppable: a status change can be made without
 * the automation ever firing (misconfigured trigger, a Monday outage, the
 * webhook secret rotating out of sync), and nothing before this cron would
 * have noticed.
 *
 * This is the backstop, not the primary mechanism: it does not send an
 * invite itself (deliberately — silently emailing a customer from a
 * best-effort sweep, possibly for an order that was never actually meant to
 * reach that stage, is a worse failure mode than a delayed human catching a
 * real gap). It only finds orders that look like they should already have
 * one and don't, and puts a human on it via the same internal-alert
 * mechanism every other "must not fail silently" case in this codebase uses
 * (lib/monitoring.js).
 *
 * A "gap" is an order that:
 *   - has a customer email on file (nothing to invite without one — same
 *     skip condition invite-webhook.js itself uses), AND
 *   - has a real Manufacturing Phase value set at all (blank means it
 *     hasn't been categorized yet — not a gap, just not there yet), AND
 *   - was created more than GRACE_PERIOD_HOURS ago (avoids false-flagging
 *     an order the automation simply hasn't had a chance to process yet),
 *     AND
 *   - has no "[PORTAL: Invitation Sent]" tagged update anywhere in its
 *     history.
 *
 * Deliberately does NOT depend on STATUS_STAGES/stageIndex ordering (which
 * order.js's own comments already flag as needing verification against this
 * board's real "Manufacturing Phase" labels) — "has any real status at all"
 * is true regardless of whether that ordering is configured correctly,
 * so this check stays valid even if that separate issue is still open.
 */

import { getAllOrders, getOrderMessages } from '../../../lib/monday';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';

const GRACE_PERIOD_HOURS = 6;
const CHECK_CONCURRENCY = 8;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // Same fail-closed discipline as every other cron in this app (PORTAL-033)
  // — an unset CRON_SECRET rejects rather than accepting "Bearer undefined".
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const results = { checked: 0, gaps: 0, skipped: 0, errors: 0 };
  const flagged = [];

  try {
    const orders = await getAllOrders();
    results.checked = orders.length;

    await mapWithConcurrency(orders, CHECK_CONCURRENCY, async (order) => {
      try {
        if (!order.customerEmail) { results.skipped++; return; }
        if (!order.status || !order.status.trim()) { results.skipped++; return; }

        const ageHours = (now - new Date(order.createdAt || now)) / (1000 * 60 * 60);
        if (ageHours < GRACE_PERIOD_HOURS) { results.skipped++; return; }

        const updates = await getOrderMessages(order.id);
        const hasInvite = updates.some(u => (u.body || '').includes('[PORTAL: Invitation Sent]'));
        if (hasInvite) { results.skipped++; return; }

        results.gaps++;
        flagged.push({
          id: order.id,
          name: order.name,
          status: order.status,
          customerEmail: order.customerEmail,
          createdAt: order.createdAt,
        });
      } catch (orderErr) {
        console.error(`Invite safety-net check error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    });

    if (flagged.length > 0) {
      const lines = flagged
        .map(o => `- ${o.name} (id ${o.id}, status "${o.status}", created ${new Date(o.createdAt).toLocaleDateString()}) — ${o.customerEmail}`)
        .join('\n');
      await reportCriticalFailure(
        'cron/invite-safety-net',
        `${flagged.length} order(s) have a Manufacturing Phase set, a customer email on file, and are more than ${GRACE_PERIOD_HOURS}h old, but have never had a portal invitation sent. Check whether the invite automation fired for these — they may be silently waiting on the customer for information nobody has actually asked for yet.`,
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
