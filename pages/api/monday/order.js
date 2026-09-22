/**
 * GET /api/monday/order — fetch the logged-in customer's order
 *
 * PORTAL-037: this file used to also handle PATCH (contact-info updates),
 * but nothing in the app has ever called it — the real contact-update flow
 * goes through saveSetup('contact_update', ...) -> POST /api/portal/setup
 * (confirmed via a repo-wide search for both 'monday/order' and a PATCH
 * fetch call; the admin panel's own PATCH call targets the plural
 * /api/monday/orders, a different endpoint entirely). Removed rather than
 * fixed in place: it also carried a latent bug (contactName was treated as
 * "changed" whenever merely present, unlike address/phone which compared
 * against the current value), and dead code with a known bug is worse than
 * no code — if contact-update ever needs to move here, it should be
 * rebuilt against the current session/order helpers, not revived as-is.
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById, getOrdersByEmail } from '../../../lib/monday';

export default async function handler(req, res) {
  // Auth: customer session cookie
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // ── GET — supports single order (by stored ID) or all orders for email ────
  // PORTAL-015: this whole block previously had no try/catch — unlike every
  // other handler in this codebase, a Monday API error here (timeout, rate
  // limit, transient 5xx) would crash the request with an unhandled
  // rejection / raw 500 instead of a clean error response.
  if (req.method === 'GET') {
    try {
      // PLAN-17: the order switcher (pages/portal/index.js) needs the FULL
      // list of this customer's orders even after one is already bound to
      // the session, so it can offer to switch to a different one — the
      // default (no ?all=1) path below only ever returns the single bound
      // order once session.orderId is set, which is exactly right for the
      // common single-order case (one fast lookup, not a full email scan)
      // but leaves a multi-order customer with no way to discover their
      // other orders short of signing out and back in. Opt-in via a query
      // param rather than changing the default response shape, so every
      // other existing caller of this endpoint is unaffected.
      if (req.query.all === '1') {
        const orders = await getOrdersByEmail(session.email);
        if (!orders.length) return res.status(404).json({ error: 'No orders found.' });
        return res.status(200).json({
          orders,
          currentOrderId: session.orderId || orders[0].id,
          impersonatedBy: session.impersonatedBy || null,
        });
      }

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
    } catch (err) {
      console.error('Order GET error:', err);
      return res.status(500).json({ error: 'Failed to load order. Please try again.' });
    }
  }

  return res.status(405).end();
}
