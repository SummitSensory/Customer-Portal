/**
 * GET  /api/monday/messages?orderId=...   — get messages for an order
 * POST /api/monday/messages               — post a new message
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderMessages, postOrderMessage, getOrderById, setStatusLabel } from '../../../lib/monday';
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
      // Tag all portal messages so they can be isolated from internal Monday.com
      // updates, AND stamp the true sender (customer vs. staff) directly into the
      // body. Monday's create_update API always attributes the update to whoever
      // owns MONDAY_API_TOKEN — never to the actual customer — so the portal UI
      // cannot tell "me" from "them" from creator.email alone (confirmed 2026-08-17:
      // every message Kalen Siddens sent through his portal showed creator "Bryan
      // Shepherd"). Without this tag, a customer's own sent message rendered as if
      // it had come from staff, and the unread-reply badge could never light up.
      // See messageIsStaff() in pages/portal/index.js, which reads this tag.
      const originTag = identity.role === 'staff' ? '[PORTAL:STAFF]' : '[PORTAL:CUSTOMER]';
      const message = await postOrderMessage(orderId, `[PORTAL]${originTag}\n${body.trim()}`);

      // Notify team + flag the queue when a customer sends a message
      if (identity.role === 'customer') {
        const order = await getOrderById(orderId);
        await notifyTeamNewMessage(
          order?.name || orderId,
          identity.email,
          body.trim().slice(0, 100)
        ).catch(console.error);
        await setStatusLabel(orderId, 'messageStatus', 'Needs Reply').catch(console.error);
      }

      // Staff replying from the Admin Portal should clear the queue flag too —
      // this is the one reply path that doesn't depend on the Monday.com
      // "update created" webhook (see update-webhook.js), so it must set this
      // directly rather than relying on that automation firing.
      if (identity.role === 'staff') {
        await setStatusLabel(orderId, 'messageStatus', 'Replied').catch(console.error);
      }

      return res.status(201).json({ message });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  }

  return res.status(405).end();
}
