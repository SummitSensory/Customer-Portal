/**
 * GET  /api/monday/orders          — admin: list all orders
 * GET  /api/monday/orders?id=...   — admin: one order WITH mirror columns
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
  isCustomerFacingStatus,
} from '../../../lib/email';

export default async function handler(req, res) {
  // Auth: staff session (NextAuth)
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    // ?id= returns the full getOrderById() record. getAllOrders() leaves out
    // mirror columns on purpose (adding them caused the 2026-09-24 outage),
    // so the admin color panel's gates and the contact/POC columns were
    // always blank in the list — the dashboard loads this per expanded row.
    if (req.query.id) {
      try {
        const order = await getOrderById(req.query.id);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        return res.status(200).json({ order });
      } catch (err) {
        console.error('getOrderById (admin) error:', err);
        return res.status(500).json({ error: 'Failed to load order.' });
      }
    }
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

    let order;
    try {
      order = await getOrderById(id);
    } catch (err) {
      console.error('Order PATCH load error:', err);
      return res.status(500).json({ error: 'Failed to load order.' });
    }
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    // Each field is saved independently and reported on its own. This used to
    // be one try/catch: a status write + customer email could succeed, then a
    // later tracking/balance failure returned 500 "Failed to save", hiding
    // that the status changed and the customer was emailed.
    //
    // updateTrackingNumber()/updateBalance() return null (with only a
    // console.warn) when their column env var isn't configured — surfaced as
    // an explicit warning rather than a silent revert on next load.
    const warnings = [];
    const saved = [];
    const failed = [];

    if (status !== undefined && status !== order.status) {
      try {
        await updateOrderStatus(id, status);
        saved.push('status');
        // Dedup against status-balance-webhook.js: that webhook reacts to
        // this exact same column write and would otherwise send this same
        // email again a few seconds later — see sendCustomerNotificationOnce.
        // Only customer-facing phases are emailed (lib/email.js). A failed
        // send is NOT marked notified, so the Monday webhook's delivery of
        // this same change can still retry it.
        if (order.customerEmail && isCustomerFacingStatus(status)) {
          try {
            const result = await sendCustomerNotificationOnce(id, 'Status', status, () =>
              notifyCustomerStatusChange(order.customerEmail, order.contactName, order.name, status)
            );
            if (result?.markFailed) {
              warnings.push(`Status saved and the customer WAS emailed about "${status}", but the "already notified" marker didn't save — staff have been alerted. Don't re-send.`);
            }
          } catch (err) {
            console.error('Status change notification failed:', err.message);
            warnings.push(`Status saved, but emailing the customer about "${status}" failed: ${err.message}`);
          }
        }
      } catch (err) {
        console.error('Order PATCH status error:', err);
        failed.push('status');
        warnings.push(`Status was NOT saved: ${err.message}`);
      }
    }

    if (trackingNumber !== undefined && trackingNumber !== order.trackingNumber) {
      try {
        const result = await updateTrackingNumber(id, trackingNumber);
        if (result === null) {
          failed.push('trackingNumber');
          warnings.push('Tracking number was NOT saved to Monday.com — MONDAY_COL_TRACKING_WRITE is not configured. Set it in Vercel env vars to enable this field.');
        } else {
          saved.push('trackingNumber');
        }
      } catch (err) {
        console.error('Order PATCH tracking error:', err);
        failed.push('trackingNumber');
        warnings.push(`Tracking number was NOT saved: ${err.message}`);
      }
    }

    // PORTAL-004: the incoming `balance` may arrive as a string ("150.00")
    // — compare numerically so an unchanged value isn't treated as a change.
    const nextBalance = balance !== undefined ? parseFloat(balance) : undefined;
    // PORTAL-042: a non-numeric balance used to silently no-op.
    if (nextBalance !== undefined && !Number.isFinite(nextBalance)) {
      failed.push('balance');
      warnings.push(`Balance was NOT saved — "${balance}" is not a valid number.`);
    } else if (nextBalance !== undefined && nextBalance !== order.balance) {
      try {
        const balanceResult = await updateBalance(id, nextBalance);
        if (balanceResult === null) {
          failed.push('balance');
          warnings.push('Balance was NOT saved to Monday.com — MONDAY_COL_BALANCE is not configured. Set it in Vercel env vars to enable this field.');
        } else {
          saved.push('balance');
        }
        // No customer email for balance changes (Bryan, 2026-10-06).
      } catch (err) {
        console.error('Order PATCH balance error:', err);
        failed.push('balance');
        warnings.push(`Balance was NOT saved: ${err.message}`);
      }
    }

    // 200 whenever anything was saved (or there was nothing to save), so the
    // UI shows the per-field warnings; 500 only when every attempted write
    // failed outright.
    if (failed.length && !saved.length) {
      return res.status(500).json({ error: 'Failed to update order.', warnings, saved, failed });
    }
    return res.status(200).json({ ok: true, warnings, saved, failed });
  }

  return res.status(405).end();
}
