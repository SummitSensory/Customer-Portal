/**
 * POST /api/portal/freight-notify-preference
 * Body: { enabled: boolean }
 * Lets the signed-in customer turn "Freight Email Alerts" on/off — controls
 * whether the AfterShip webhook (pages/api/aftership/webhook.js) emails them
 * on Frame/Mats shipment status changes.
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { setFreightNotifyPreference } from '../../../lib/monday';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) required.' });
  }

  try {
    await setFreightNotifyPreference(session.orderId, enabled);
    return res.status(200).json({ ok: true, enabled });
  } catch (err) {
    console.error('freight-notify-preference: failed to update:', err);
    return res.status(500).json({ error: 'Failed to update preference.' });
  }
}
