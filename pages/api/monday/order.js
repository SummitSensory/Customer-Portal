/**
 * GET  /api/monday/order   — fetch the logged-in customer's order
 * PATCH /api/monday/order  — update contact info (address, phone, contact name)
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import {
  getOrderById,
  getOrdersByEmail,
  updateOrderColumn,
  postTaggedUpdate,
  COLS,
} from '../../../lib/monday';
import {
  notifyTeamContactChange,
} from '../../../lib/email';

export default async function handler(req, res) {
  // Auth: customer session cookie
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // ── GET — supports single order (by stored ID) or all orders for email ────
  if (req.method === 'GET') {
    // If session has a specific orderId (set at login), use it directly
    if (session.orderId) {
      const order = await getOrderById(session.orderId);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      // impersonatedBy is only set on sessions minted by /api/admin/impersonate —
      // surfaced here so the portal UI can show its "viewing as staff" banner.
      return res.status(200).json({ order, impersonatedBy: session.impersonatedBy || null });
    }

    // Otherwise look up all orders for this email (repeat customer support)
    const orders = await getOrdersByEmail(session.email);
    if (!orders.length) return res.status(404).json({ error: 'No orders found.' });
    if (orders.length === 1) return res.status(200).json({ order: orders[0], impersonatedBy: session.impersonatedBy || null });
    return res.status(200).json({ orders, impersonatedBy: session.impersonatedBy || null }); // portal shows order picker
  }

  // For write operations, require a specific order
  const order = session.orderId
    ? await getOrderById(session.orderId)
    : (await getOrdersByEmail(session.email))[0];
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  // ── PATCH — update contact info ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { address, phone, contactName } = req.body || {};
    const changed = [];

    try {
      // address — long_text columns require the complex value wrapped as
      // {text: "..."} in Monday's API; a bare string throws "invalid value"
      // (confirmed 2026-07-28 via a live GraphQL error on this exact call).
      if (address !== undefined && address !== order.address) {
        await updateOrderColumn(order.id, COLS.address, { text: address });
        changed.push('Ship-to address');
      }

      // phone and contactName are mirror columns (read-only in Monday) or unmapped.
      // Store changes as a tagged update so the team can update the source board.
      const notes = [];
      if (phone !== undefined && phone !== order.phone) {
        notes.push(`Phone: ${phone}`);
        changed.push('Phone');
      }
      if (contactName !== undefined) {
        notes.push(`Contact name: ${contactName}`);
        changed.push('Primary contact');
      }
      if (notes.length > 0) {
        await postTaggedUpdate(
          order.id,
          'PORTAL: Contact Update Requested',
          `Customer requested contact update on ${new Date().toLocaleDateString()}.\n${notes.join('\n')}`
        );
      }

      if (changed.length > 0) {
        await notifyTeamContactChange(order.name, session.email, changed).catch(console.error);
      }

      return res.status(200).json({ ok: true, changed });
    } catch (err) {
      console.error('Order update error:', err);
      return res.status(500).json({ error: 'Failed to update. Please try again.' });
    }
  }

  return res.status(405).end();
}
