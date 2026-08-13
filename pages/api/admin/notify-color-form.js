/**
 * POST /api/admin/notify-color-form
 * Sends the "Color Selection Form Ready" notification email to the customer
 * (EM-05). Requires an active staff session (Azure AD / NextAuth).
 * Body: { orderId }
 *
 * EM-05 previously existed only as an unwired template in lib/email.js — see
 * Customer-Portal-Process-Flow.md OPEN-2. Wired up 2026-08-13, following the
 * exact same manual-staff-trigger pattern as EM-07 (notify-installation.js).
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderById } from '../../../lib/monday';
import { notifyCustomerColorFormReady } from '../../../lib/email';

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
    await notifyCustomerColorFormReady(email, name, order.name);

    return res.status(200).json({ ok: true, sentTo: email });
  } catch (err) {
    console.error('Color form notification error:', err);
    return res.status(500).json({ error: 'Failed to send notification.' });
  }
}
