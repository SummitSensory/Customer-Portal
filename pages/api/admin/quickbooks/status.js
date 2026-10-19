/**
 * GET  /api/admin/quickbooks/status — connection + automatic Prismatic
 *       invoicing settings, and the Prismatic orders confirmed before
 *       go-live (never charged automatically) for staff to check by hand.
 * POST /api/admin/quickbooks/status { action: 'disconnect' } — revoke and
 *       clear the stored connection.
 * Staff only.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { connectionStatus, disconnect, redirectUri } from '../../../../lib/quickbooks';
import { invoicingSettings, invoicingReady, olderPrismaticOrders } from '../../../../lib/prismaticInvoicing';
import { getAllOrders } from '../../../../lib/monday';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method === 'POST') {
    if (req.body?.action !== 'disconnect') return res.status(400).json({ error: 'Unknown action.' });
    try {
      await disconnect();
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: `Disconnecting failed: ${err.message}` });
    }
  }
  if (req.method !== 'GET') return res.status(405).end();

  const settings = invoicingSettings();
  const [connection, orders] = await Promise.all([
    connectionStatus().catch((err) => ({ configured: true, connected: false, error: err.message })),
    getAllOrders().catch(() => []),
  ]);
  return res.status(200).json({
    connection,
    redirectUri: redirectUri(),
    invoicing: {
      enabled: settings.enabled,
      itemId: settings.itemId,
      start: settings.start ? settings.start.toISOString() : null,
      ready: invoicingReady(settings),
    },
    olderOrders: olderPrismaticOrders(orders, settings),
  });
}
