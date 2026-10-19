/**
 * GET /api/admin/color-history?orderId=…
 *
 * The order's color-selection audit trail, newest first: every confirmation
 * (portal or Jotform), auto-N/A, and staff change, read from the tagged
 * Monday updates those actions post (see lib/colorSelectionChanges.js).
 * Shown in the admin Colors panel.
 *
 * Auth: staff (NextAuth session) only.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderMessages } from '../../../lib/monday';
import { colorHistoryFromUpdates } from '../../../lib/colorSelectionChanges';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { orderId } = req.query || {};
  if (!orderId || !/^\d+$/.test(String(orderId))) return res.status(400).json({ error: 'orderId required.' });

  try {
    const updates = await getOrderMessages(String(orderId));
    return res.status(200).json({ history: colorHistoryFromUpdates(updates) });
  } catch (err) {
    console.error('color-history: failed to read updates:', err.message);
    return res.status(500).json({ error: 'Failed to load the color change history.' });
  }
}
