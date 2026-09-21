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
  sendCustomerNotificationOnce,
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
        // Dedup against status-balance-webhook.js: that webhook reacts to
        // this exact same column write (fired by a Monday automation, once
        // registered — see OPEN-1 in Customer-Portal-Process-Flow.md) and
        // would otherwise send this same email again a few seconds later.
        // PORTAL-059: sendCustomerNotificationOnce() (lib/monday.js) closes
        // the race the old separate hasNotifiedValue()/markNotifiedValue()
        // calls here left open — see that function's own header comment.
        // sendFn swallows its own error (matches this endpoint's prior
        // behavior: still record the "notified" marker even if the email
        // itself failed, rather than let a transient email failure spam a
        // resend on every future admin edit).
        if (order.customerEmail) {
          await sendCustomerNotificationOnce(id, 'Status', status, () =>
            notifyCustomerStatusChange(order.customerEmail, order.contactName, order.name, status).catch(console.error)
          ).catch(err => console.error('Status change notification failed:', err.message));
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
      // PORTAL-042: a non-numeric balance (parseFloat -> NaN) used to fail
      // the Number.isFinite check and silently no-op with zero warning —
      // unlike the sibling "column not configured" case just above, which
      // does warn. An admin typo (or a stray non-numeric value from the
      // edit UI) looked exactly like a successful save.
      if (nextBalance !== undefined && !Number.isFinite(nextBalance)) {
        warnings.push(`Balance was NOT saved — "${balance}" is not a valid number.`);
      } else if (nextBalance !== undefined && nextBalance !== order.balance) {
        const balanceResult = await updateBalance(id, nextBalance);
        if (balanceResult === null) {
          warnings.push('Balance was NOT saved to Monday.com — MONDAY_COL_BALANCE is not configured. Set it in Vercel env vars to enable this field.');
        } else if (order.customerEmail) {
          // Same dedup rationale (and PORTAL-059 fix) as the status branch above.
          const balanceKey = nextBalance.toFixed(2);
          await sendCustomerNotificationOnce(id, 'Balance', balanceKey, () =>
            notifyCustomerBalanceChange(order.customerEmail, order.contactName, order.name, nextBalance).catch(console.error)
          ).catch(err => console.error('Balance change notification failed:', err.message));
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
