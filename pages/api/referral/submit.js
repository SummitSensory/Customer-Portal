/**
 * POST /api/referral/submit
 * Logs a "Refer a Friend" submission from the portal onto the standalone
 * Referrals board in Monday.com. Reward amount (2% of the referred friend's
 * eventual order, $25 floor / $500 cap) is computed by Monday itself once
 * staff enters the referred order's value — not calculated here.
 *
 * Body: { friendName, friendEmail, friendPhone, message }
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById, createReferralItem, findRecentReferral } from '../../../lib/monday';
import { notifyTeamNewReferral } from '../../../lib/email';
import { allowRequest } from '../../../lib/rateLimit';

// PORTAL-063: findRecentReferral()'s own dedupe (lib/monday.js, PORTAL-013)
// is a read-then-create check against Monday — not atomic. A true
// double-click (or a client retry firing before the first request's
// createReferralItem() write lands) can still get two requests both reading
// "no recent referral" before either one's create actually completes,
// creating two duplicate Referrals board rows. lib/concurrency.js was
// checked first per this fix's ground rules — it only exports
// mapWithConcurrency, a worker-pool limiter for cron loops, nothing that
// already covers a single-key in-flight lock — so this is a small,
// self-contained one scoped to exactly this endpoint's race rather than a
// speculative addition to a shared file nobody else needs it in yet.
//
// Only guards this one process's in-memory state — like every other
// in-memory limiter in this codebase (lib/rateLimit.js says the same of
// itself), a genuinely simultaneous double-click landing on two different
// serverless instances isn't caught by this alone. findRecentReferral()'s
// existing ~2-minute Monday-side window still covers that broader case;
// this lock closes the much more common single-instance race outright
// instead of merely narrowing it.
const inFlightReferralKeys = new Set();

function referralLockKey(orderId, friendEmail) {
  return `${orderId}::${(friendEmail || '').trim().toLowerCase()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // PORTAL-027: each submission triggers a team-notification email and a new
  // Monday board item — cap how fast one session can fire these. See
  // lib/rateLimit.js for the in-memory limiter's scope/limitations.
  if (!allowRequest(`referral-submit:${session.email}`, { maxRequests: 10, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { friendName, friendEmail, friendPhone, message } = req.body || {};

  if (!friendName || !friendEmail) {
    return res.status(400).json({ error: 'Friend name and email are required.' });
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(friendEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // PORTAL-063: reject a second concurrent request for the exact same
  // (order, friend email) pair outright rather than letting it race past
  // findRecentReferral()'s own read-then-create check below. See this
  // file's header comment.
  const lockKey = referralLockKey(session.orderId, friendEmail);
  if (inFlightReferralKeys.has(lockKey)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }
  inFlightReferralKeys.add(lockKey);

  try {
    let order;
    try {
      order = await getOrderById(session.orderId);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
    } catch (err) {
      console.error('Referral: failed to load order:', err);
      return res.status(500).json({ error: 'Failed to load order.' });
    }

    // PORTAL-013: catch a near-simultaneous duplicate submission (double-click,
    // client retry) before creating a second Referrals board row for the same
    // friend from the same order. See findRecentReferral() in lib/monday.js.
    try {
      const existing = await findRecentReferral(session.orderId, friendEmail);
      if (existing) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
    } catch (err) {
      // Non-fatal — if the dedupe check itself fails, proceed with the
      // submission rather than blocking a legitimate referral over it.
      console.error('Referral dedupe check failed (continuing anyway):', err.message);
    }

    let referralItemId;
    try {
      referralItemId = await createReferralItem(order, {
        referrerName: order.name,
        referrerEmail: session.email,
        friendName,
        friendEmail,
        friendPhone: friendPhone || '',
        message: message || '',
      });
    } catch (err) {
      console.error('Referral submit error:', err);
      return res.status(500).json({ error: 'Failed to submit referral. Please try again or contact us directly.' });
    }

    notifyTeamNewReferral(order.name, session.email, friendName, friendEmail, referralItemId).catch(console.error);

    return res.status(200).json({ ok: true });
  } finally {
    inFlightReferralKeys.delete(lockKey);
  }
}
