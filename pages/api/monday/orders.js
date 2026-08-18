/**
 * GET  /api/monday/orders          — admin: list all orders
 * PATCH /api/monday/orders?id=...  — admin: update status or tracking number
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import {
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  updateTrackingNumber,
  updateBalance,
} from '../../../lib/monday';
import {
  notifyCustomerStatusChange,
  notifyCustomerBalanceChange,
} from '../../../lib/email';

export default async function handler(req, res) {
  // Auth: staff session (NextAuth)
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // ── GET: list all orders ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const orders = await getAllOrders();
      return res.status(200).json({ orders });
    } catch (err) {
      console.error('getAllOrders error:', err);
      return res.status(500).json({ error: 'Failed to load orders.' });
    }
  }

  // ── PATCH: update a single order ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { status, trackingNumber, balance } = req.body || {};

    if (!id) return res.status(400).json({ error: 'Order ID required.' });

    try {
      const order = await getOrderById(id);
      if (!order) return res.status(404).json({ error: 'Order not found.' });

      if (status !== undefined && status !== order.status) {
        await updateOrderStatus(id, status);
        if (order.customerEmail) {
          await notifyCustomerStatusChange(
            order.customerEmail, order.contactName, order.name, status
          ).catch(console.error);
        }
      }

      if (trackingNumber !== undefined && trackingNumber !== order.trackingNumber) {
        await updateTrackingNumber(id, trackingNumber);
      }

      // PORTAL-004: order.balance is now a real parsed number (or null) instead
      // of always-undefined, but the incoming `balance` from the request body
      // may still arrive as a string (e.g. "150.00" from a form input) — a
      // strict !== against a number would treat that as "changed" every time
      // and re-notify the customer on every save even when nothing changed.
      // Compare numerically instead.
      const nextBalance = balance !== undefined ? parseFloat(balance) : undefined;
      if (nextBalance !== undefined && Number.isFinite(nextBalance) && nextBalance !== order.balance) {
        await updateBalance(id, nextBalance);
        if (order.customerEmail) {
          await notifyCustomerBalanceChange(
            order.customerEmail, order.contactName, order.name, nextBalance
          ).catch(console.error);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Order PATCH error:', err);
      return res.status(500).json({ error: 'Failed to update order.' });
    }
  }

  return res.status(405).end();
}
