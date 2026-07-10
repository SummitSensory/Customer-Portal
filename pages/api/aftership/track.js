/**
 * GET /api/aftership/track?slug=...&number=...
 * Returns normalized AfterShip tracking for a shipment.
 *
 * Auth: staff (NextAuth) OR the customer whose order owns this tracking number.
 * The number must match one of the order's known tracking fields, so a customer
 * can only look up shipments on their own order.
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById } from '../../../lib/monday';
import { trackShipment } from '../../../lib/aftership';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { slug, number } = req.query;
  if (!slug || !number) return res.status(400).json({ error: 'slug and number are required.' });

  // Auth — staff session bypasses the ownership check
  const staffSession = await getServerSession(req, res, authOptions);
  let order = null;

  if (!staffSession) {
    const cookies = parse(req.headers.cookie || '');
    const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
    if (!customerSession) return res.status(401).json({ error: 'Not authenticated.' });

    order = await getOrderById(customerSession.orderId);

    // The requested number must belong to this order (any shipment field).
    const known = [
      order?.frameTrackingId,
      order?.matsTrackingId,
      order?.trackingNumber,
      ...(order?.matTracking && order.matTracking !== 'N/A'
        ? order.matTracking.split(',').map(t => t.trim())
        : []),
    ].filter(Boolean);

    if (!known.includes(number)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
  }

  try {
    const tracking = await trackShipment(slug, number, {
      title: order?.name,
      orderId: order?.id,
    });
    if (!tracking) return res.status(404).json({ error: 'Tracking info not available.' });
    return res.status(200).json({ tracking });
  } catch (err) {
    console.error('AfterShip track endpoint error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tracking info.' });
  }
}
