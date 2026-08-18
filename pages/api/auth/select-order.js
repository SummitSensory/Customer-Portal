/**
 * POST /api/auth/select-order
 * Body: { orderId }
 *
 * PORTAL-007: customers/organizations with more than one order at Summit
 * Sensory Gym get a session with NO bound orderId from verify-code.js (see
 * that file's comment) and the portal shows an order picker (OrderPicker in
 * pages/portal/index.js). This endpoint is what actually binds the session
 * to whichever order the customer picks — every other order-scoped endpoint
 * (messages, setup, files, freight-notify-preference, referrals, etc.)
 * authorizes by checking the request's orderId against session.orderId, so
 * re-signing the cookie here (rather than only tracking the choice in
 * client-side React state) means none of those endpoints' authorization
 * logic needs to change to support multi-order customers.
 */

import { parse, serialize } from 'cookie';
import { verifyCustomerSession, signCustomerSession, SESSION_COOKIE, cookieOptions } from '../../../lib/auth';
import { getOrdersByEmail } from '../../../lib/monday';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  // Re-derive the customer's own order list server-side rather than trusting
  // the client — confirms the requested orderId genuinely belongs to this
  // customer's email before binding the session to it.
  let orders;
  try {
    orders = await getOrdersByEmail(session.email);
  } catch (err) {
    console.error('select-order: Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Unable to load orders. Please try again.' });
  }

  const match = orders.find(o => o.id === orderId);
  if (!match) return res.status(403).json({ error: 'That order is not linked to your account.' });

  const sessionToken = await signCustomerSession(session.email, match.id, match.name);
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, sessionToken, cookieOptions(60 * 60 * 24 * 7)));

  return res.status(200).json({ ok: true, order: match });
}
