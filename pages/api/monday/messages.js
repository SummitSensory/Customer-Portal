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
import { notifyPendingStaffReplies } from '../../../lib/replyNotify';
import { allowRequest } from '../../../lib/rateLimit';
import { customerVisibleMessages } from '../../../lib/messageOrigin';

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

/**
 * EM-11 for a staff reply sent from the Admin Portal Messages tab — sent
 * right away rather than waiting on Monday's "update created" webhook. See
 * lib/replyNotify.js for which messages count and the id-based dedupe that
 * keeps this, update-webhook.js and the safety-net cron from double-sending.
 * Never fails the request: the message is already posted, and a missed email
 * is retried by cron/message-reply-safety-net.
 */
async function notifyCustomerOfStaffReply(orderId, message) {
  try {
    // The just-posted message may not be readable yet (Monday read-after-write
    // lag), so make sure it's in the history we evaluate.
    const updates = await getOrderMessages(orderId);
    if (message?.id && !updates.some(u => String(u.id) === String(message.id))) updates.push({ ...message, replies: [] });
    await notifyPendingStaffReplies(orderId, { updates, includeFreshAdminPosts: true });
  } catch (err) {
    console.error(`Staff reply posted on order ${orderId}, but the customer reply notification (EM-11) FAILED:`, err);
  }
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
      // Customers get only portal chat, never internal updates or staff
      // emails — see customerVisibleMessages in lib/messageOrigin.js.
      return res.status(200).json({
        messages: identity.role === 'customer' ? customerVisibleMessages(messages) : messages,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load messages.' });
    }
  }

  if (req.method === 'POST') {
    // PORTAL-036: this route triggers a real team-notification email
    // (customer sends) and a real Monday write on every call, but unlike
    // setup.js/color-selection.js had no rate limit — a valid session could
    // loop it to spam team emails/Monday writes at no cost.
    if (!allowRequest(`messages-post:${identity.email}`, { maxRequests: 20, windowMs: 60_000 })) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }

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

      // Notify team + flag the queue when a customer sends a message. The
      // message is already posted, so nothing below may turn this into a
      // 500 — the customer would retry and post a duplicate (audit
      // 2026-10-09: getOrderById here had no catch of its own).
      if (identity.role === 'customer') {
        try {
          const order = await getOrderById(orderId);
          await notifyTeamNewMessage(
            order?.name || identity.orderName || orderId,
            identity.email,
            body.trim().slice(0, 100)
          );
        } catch (err) {
          console.error(`Customer message posted on order ${orderId}, but the team notification FAILED:`, err);
        }
        await setStatusLabel(orderId, 'messageStatus', 'Needs Reply').catch(console.error);
      }

      // Staff replying from the Admin Portal should clear the queue flag and
      // email the customer here — this path doesn't depend on the Monday.com
      // "update created" webhook (see update-webhook.js), so it must do both
      // directly rather than relying on that automation firing.
      if (identity.role === 'staff') {
        await setStatusLabel(orderId, 'messageStatus', 'Replied').catch(console.error);
        await notifyCustomerOfStaffReply(orderId, message);
      }

      return res.status(201).json({
        message: identity.role === 'customer' && message
          ? (customerVisibleMessages([message])[0] || { id: message.id })
          : message,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  }

  return res.status(405).end();
}
