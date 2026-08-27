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

      // updateTrackingNumber()/updateBalance() below both return null (with
      // only a console.warn) when their target Monday column env var isn't
      // configured — previously that was invisible to the admin who clicked
      // Save: the field just silently reverted to the old value on next load,
      // indistinguishable from a real transient failure. Surface it as an
      // explicit warning in the response instead.
      const warnings = [];

      if (status !== undefined && status !== order.status) {
        await updateOrderStatus(id, status);
        if (order.customerEmail) {
          await notifyCustomerStatusChange(
            order.customerEmail, order.contactName, order.name, status
          ).catch(console.error);
        }
      }

      if (trackingNumber !== undefined && trackingNumber !== order.trackingNumber) {
        const result = await updateTrackingNumber(id, trackingNumber);
        if (result === null) {
          warnings.push('Tracking number was NOT saved to Monday.com — MONDAY_COL_TRACKING_WRITE is not configured. Set it in Vercel env vars to enable this field.');
        }
      }

      // PORTAL-004: order.balance is now a real parsed number (or null) instead
      // of always-undefined, but the incoming `balance` from the request body
      // may still arrive as a string (e.g. "150.00" from a form input) — a
      // strict !== against a number would treat that as "changed" every time
      // and re-notify the customer on every save even when nothing changed.
      // Compare numerically instead.
      const nextBalance = balance !== undefined ? parseFloat(balance) : undefined;
      if (nextBalance !== undefined && Number.isFinite(nextBalance) && nextBalance !== order.balance) {
        const balanceResult = await updateBalance(id, nextBalance);
        if (balanceResult === null) {
          warnings.push('Balance was NOT saved to Monday.com — MONDAY_COL_BALANCE is not configured. Set it in Vercel env vars to enable this field.');
        } else if (order.customerEmail) {
          await notifyCustomerBalanceChange(
            order.customerEmail, order.contactName, order.name, nextBalance
          ).catch(console.error);
        }
      }

      return res.status(200).json({ ok: true, warnings });
    } catch (err) {
      console.error('Order PATCH error:', err);
      return res.status(500).json({ error: 'Failed to update order.' });
    }
  }

  return res.status(405).end();
}
