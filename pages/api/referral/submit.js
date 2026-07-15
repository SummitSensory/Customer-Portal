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
import { getOrderById, createReferralItem } from '../../../lib/monday';
import { notifyTeamNewReferral } from '../../../lib/email';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

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

  try {
    await createReferralItem(order, {
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

  notifyTeamNewReferral(order.name, session.email, friendName, friendEmail).catch(console.error);

  return res.status(200).json({ ok: true });
}
