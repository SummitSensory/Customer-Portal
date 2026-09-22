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
import { getOrderById, resolveDeliveryContacts } from '../../../lib/monday';
import { trackShipment, buildTrackingTitle, buildCustomFields } from '../../../lib/aftership';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { slug, number } = req.query;
  if (!slug || !number) return res.status(400).json({ error: 'slug and number are required.' });

  // Auth — staff session bypasses the ownership check
  const staffSession = await getServerSession(req, res, authOptions);
  let order = null;
  let shipmentKey = null;
  let accessoryItemName = null;

  if (!staffSession) {
    const cookies = parse(req.headers.cookie || '');
    const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
    if (!customerSession) return res.status(401).json({ error: 'Not authenticated.' });

    order = await getOrderById(customerSession.orderId);

    const matsNumbers = order?.matTracking && order.matTracking !== 'N/A'
      ? order.matTracking.split(',').map(t => t.trim())
      : [];

    // The requested number must belong to this order (any shipment field).
    const known = [
      order?.frameTrackingId,
      order?.matsTrackingId,
      order?.trackingNumber,
      ...matsNumbers,
      // Therapy Equipment & Accessories — tracking numbers from Monday subitems
      ...(order?.accessoryItems || []).map(a => a.trackingNumber),
    ].filter(Boolean);

    if (!known.includes(number)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    // Which shipment this is, for a disambiguated AfterShip title (see
    // buildTrackingTitle) and the SHIPMENT_TYPE/first_name custom fields.
    // A generic/legacy tracking number (order.trackingNumber /
    // order.matTracking with no live column behind it — see lib/monday.js's
    // COLS.matTracking) falls back to the bare order name, same as before.
    if (number === order?.frameTrackingId) shipmentKey = 'frame';
    else if (number === order?.matsTrackingId || matsNumbers.includes(number)) shipmentKey = 'mats';
    else {
      const accessoryMatch = (order?.accessoryItems || []).find((a) => a.trackingNumber === number);
      if (accessoryMatch) { shipmentKey = 'accessory'; accessoryItemName = accessoryMatch.name; }
    }
  }

  try {
    // Direct requirement (2026-09-03): register the customer's own approved
    // delivery contact(s) with AfterShip so its own native notifications
    // have a real recipient, not just this order's title. Only meaningful
    // for the customer-session path — a staff lookup has no `order` loaded.
    const { primary, secondary } = order ? resolveDeliveryContacts(order) : {};
    const contacts = [primary, secondary].filter(Boolean);
    const tracking = await trackShipment(slug, number, {
      title: buildTrackingTitle(order?.name, shipmentKey, accessoryItemName) || order?.name,
      orderId: order?.id,
      customerName: order?.name,
      contacts,
      customFields: buildCustomFields(shipmentKey, contacts),
    });
    if (!tracking) return res.status(404).json({ error: 'Tracking info not available.' });
    return res.status(200).json({ tracking });
  } catch (err) {
    console.error('AfterShip track endpoint error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tracking info.' });
  }
}
