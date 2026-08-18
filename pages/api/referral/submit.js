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
}
