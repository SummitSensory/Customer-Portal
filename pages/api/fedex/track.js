/**
 * GET /api/fedex/track?number=...
 * Returns live tracking data for a given FedEx tracking number.
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById, orderMatchesEmail } from '../../../lib/monday';
import { trackShipment } from '../../../lib/fedex';
import { ORDER_NOT_OWNED_ERROR } from '../../../lib/apiAuth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Tracking number required.' });

  // Auth check — either staff or customer whose order has this tracking number
  const staffSession = await getServerSession(req, res, authOptions);
  if (!staffSession) {
    const cookies = parse(req.headers.cookie || '');
    const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
    if (!customerSession) return res.status(401).json({ error: 'Not authenticated.' });

    // AUDIT-2026-10-06: no order picked yet (multi-order session) → clear
    // 400 instead of getOrderById(undefined); and the order read is now
    // inside a try — it used to sit outside every try/catch, so a Monday
    // blip crashed the route (unhandled 500 + urgent alert email).
    if (!customerSession.orderId) return res.status(400).json({ error: 'Please select an order first.' });

    // Verify the tracking number belongs to their order
    let order;
    try {
      order = await getOrderById(customerSession.orderId);
    } catch (err) {
      console.warn('FedEx track: failed to load order:', err.message);
      return res.status(503).json({ error: 'Tracking is temporarily unavailable. Please try again shortly.' });
    }
    // Same ownership rule as lib/apiAuth.js's loadSessionOrder.
    if (order && !orderMatchesEmail(order, customerSession.email)) {
      return res.status(401).json({ error: ORDER_NOT_OWNED_ERROR, code: 'ORDER_NOT_OWNED' });
    }
    if (order?.trackingNumber !== number) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
  }

  try {
    const tracking = await trackShipment(number);
    if (!tracking) return res.status(404).json({ error: 'Tracking info not available.' });
    return res.status(200).json({ tracking });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch tracking info.' });
  }
}
