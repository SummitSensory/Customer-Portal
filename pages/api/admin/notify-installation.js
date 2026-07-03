/**
 * POST /api/admin/notify-installation
 * Sends the installation-ready notification email to the customer.
 * Requires an active staff session (Azure AD / NextAuth).
 * Body: { orderId }
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderById } from '../../../lib/monday';
import { notifyCustomerInstallationReady } from '../../../lib/email';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  try {
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const email = order.customerEmail;
    if (!email) return res.status(400).json({ error: 'Order has no customer email.' });

    const name = order.firstName || order.pocName?.split(' ')[0] || '';
    await notifyCustomerInstallationReady(email, name, order.name);

    return res.status(200).json({ ok: true, sentTo: email });
  } catch (err) {
    console.error('Installation notification error:', err);
    return res.status(500).json({ error: 'Failed to send notification.' });
  }
}
