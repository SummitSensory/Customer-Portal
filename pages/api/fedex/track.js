/**
 * GET /api/fedex/track?number=...
 * Returns live tracking data for a given FedEx tracking number.
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById } from '../../../lib/monday';
import { trackShipment } from '../../../lib/fedex';

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

    // Verify the tracking number belongs to their order
    const order = await getOrderById(customerSession.orderId);
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
