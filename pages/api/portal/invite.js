/**
 * POST /api/portal/invite
 * Sends a portal invitation email to a customer and logs the invite timestamp
 * to Monday.com as a tagged update.
 *
 * Body: { orderId }
 * Auth: staff (NextAuth session) only
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderById, postTaggedUpdate } from '../../../lib/monday';
import { sendPortalInvitation } from '../../../lib/email';

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
  } catch {
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  if (!order.customerEmail) {
    return res.status(400).json({ error: 'Order has no customer email address.' });
  }

  try {
    // Send the invitation email
    await sendPortalInvitation(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name
    );

    // Log invite timestamp to Monday.com for reminder tracking
    await postTaggedUpdate(
      orderId,
      'PORTAL: Invitation Sent',
      `Portal invitation sent to ${order.customerEmail} by ${staffSession.user?.email || 'staff'} on ${new Date().toLocaleDateString()}.`
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Invitation error:', err);
    return res.status(500).json({ error: 'Failed to send invitation.' });
  }
}
