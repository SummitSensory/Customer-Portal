/**
 * POST /api/admin/impersonate
 *
 * Lets an authorized staff member view and act inside a customer's portal
 * session — to walk them through a step over the phone, or to see/reproduce
 * exactly what's broken for them — without needing the customer's login code.
 *
 * Mints a short-lived (2-hour) customer session cookie tagged with the staff
 * member's email (see signImpersonationSession in lib/auth.js), so:
 *   - the portal UI shows a persistent "Viewing as staff" banner the whole time
 *   - anything the staff member does is attributable to them, not silently
 *     indistinguishable from the customer's own action
 *   - the session expires on its own in 2 hours rather than lingering
 *
 * Body: { orderId }
 * Auth: staff (NextAuth session) only
 */

import { serialize } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderById, postTaggedUpdate } from '../../../lib/monday';
import { signImpersonationSession, SESSION_COOKIE, cookieOptions } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const staffSession = await getServerSession(req, res, authOptions);
  if (!staffSession) return res.status(401).json({ error: 'Staff authentication required.' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  let order;
  try {
    order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
  } catch (err) {
    console.error('Impersonation: failed to load order:', err);
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  if (!order.customerEmail) {
    return res.status(400).json({ error: 'This order has no customer email on file — nothing to view as.' });
  }

  const staffEmail = staffSession.user?.email || 'unknown staff';

  try {
    const token = await signImpersonationSession(order.customerEmail, orderId, order.name, staffEmail);
    // 2-hour cookie lifetime to match the token's own expiry.
    res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, token, cookieOptions(60 * 60 * 2)));

    // Same tagged-update convention every other portal action already uses —
    // shows up right on the order in Monday, not just in a log only staff can see.
    await postTaggedUpdate(
      orderId,
      'PORTAL: Staff Viewing As Customer',
      `${staffEmail} started viewing/acting in this customer's portal on ${new Date().toLocaleString()} (session expires in 2 hours).`
    ).catch(err => console.error('Impersonation audit log failed (non-fatal):', err));

    return res.status(200).json({ ok: true, redirectTo: '/portal' });
  } catch (err) {
    console.error('Impersonation error:', err);
    return res.status(500).json({ error: 'Failed to start session.' });
  }
}
