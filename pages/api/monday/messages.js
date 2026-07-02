/**
 * GET  /api/monday/messages?orderId=...   — get messages for an order
 * POST /api/monday/messages               — post a new message
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderMessages, postOrderMessage, getOrderById } from '../../../lib/monday';
import { notifyTeamNewMessage } from '../../../lib/email';

async function getIdentity(req, res) {
  // Try staff session first
  const staffSession = await getServerSession(req, res, authOptions);
  if (staffSession) return { role: 'staff', email: staffSession.user.email };

  // Try customer session cookie
  const cookies = parse(req.headers.cookie || '');
  const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (customerSession) return { role: 'customer', ...customerSession };

  return null;
}

export default async function handler(req, res) {
  const identity = await getIdentity(req, res);
  if (!identity) return res.status(401).json({ error: 'Not authenticated.' });

  const orderId = req.query.orderId || req.body?.orderId;
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  // Customers can only access their own order
  if (identity.role === 'customer' && orderId !== identity.orderId) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  if (req.method === 'GET') {
    try {
      const messages = await getOrderMessages(orderId);
      return res.status(200).json({ messages });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load messages.' });
    }
  }

  if (req.method === 'POST') {
    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'Message body required.' });

    try {
      const message = await postOrderMessage(orderId, body.trim());

      // Notify team when customer sends a message
      if (identity.role === 'customer') {
        const order = await getOrderById(orderId);
        await notifyTeamNewMessage(
          order?.name || orderId,
          identity.email,
          body.trim().slice(0, 100)
        ).catch(console.error);
      }

      return res.status(201).json({ message });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  }

  return res.status(405).end();
}
