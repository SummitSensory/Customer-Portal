/**
 * GET  /api/monday/files?orderId=...  — list files for an order (customer or admin)
 * POST /api/monday/files              — admin: upload a file URL to an order
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderFiles, addFileToOrder, getOrderById } from '../../../lib/monday';
import { notifyCustomerNewFile } from '../../../lib/email';

async function getIdentity(req, res) {
  const staffSession = await getServerSession(req, res, authOptions);
  if (staffSession) return { role: 'staff', email: staffSession.user.email };

  const cookies = parse(req.headers.cookie || '');
  const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (customerSession) return { role: 'customer', ...customerSession };

  return null;
}

export default async function handler(req, res) {
  const identity = await getIdentity(req, res);
  if (!identity) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method === 'GET') {
    const orderId = req.query.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId required.' });

    if (identity.role === 'customer' && orderId !== identity.orderId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    try {
      const files = await getOrderFiles(orderId);
      return res.status(200).json({ files });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load files.' });
    }
  }

  if (req.method === 'POST') {
    // Admin only
    if (identity.role !== 'staff') return res.status(403).json({ error: 'Forbidden.' });

    const { orderId, fileUrl, fileName } = req.body || {};
    if (!orderId || !fileUrl || !fileName) {
      return res.status(400).json({ error: 'orderId, fileUrl, and fileName required.' });
    }

    try {
      const file = await addFileToOrder(orderId, fileUrl, fileName);

      // Notify customer
      const order = await getOrderById(orderId);
      if (order?.customerEmail) {
        await notifyCustomerNewFile(
          order.customerEmail, order.contactName, order.name, fileName
        ).catch(console.error);
      }

      return res.status(201).json({ file });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to upload file.' });
    }
  }

  return res.status(405).end();
}
