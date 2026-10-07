/**
 * GET  /api/monday/messages?orderId=...   — get messages for an order
 * POST /api/monday/messages               — post a new message
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderMessages, postOrderMessage, postTaggedUpdate, getOrderById, setStatusLabel, orderMatchesEmail, orderIdBelongsToEmail, toCustomerMessages } from '../../../lib/monday';
import { notifyTeamNewMessage } from '../../../lib/email';
import { notifyPendingStaffReplies } from '../../../lib/replyNotify';
import { allowRequest } from '../../../lib/rateLimit';
import { ORDER_MISMATCH_ERROR, ORDER_NOT_OWNED_ERROR, sessionActorLabel } from '../../../lib/apiAuth';

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
  if (identity.role === 'customer' && String(orderId) !== String(identity.orderId)) {
    // AUDIT-2026-10-06: a customer POST naming a different order than the
    // session is bound to is almost always a tab left open on order A after
    // the customer switched this browser to order B — say so (409
    // ORDER_MISMATCH, same contract as setup.js/color-selection.js via
    // lib/apiAuth.js's rejectOrderMismatch) so the page can prompt a reload.
    if (req.method === 'POST') {
      return res.status(409).json({ error: ORDER_MISMATCH_ERROR, code: 'ORDER_MISMATCH' });
    }
    return res.status(403).json({ error: 'Forbidden.' });
  }

  if (req.method === 'GET') {
    try {
      // AUDIT-2026-10-06 (follow-up): customer reads also re-check that the
      // order still belongs to the session's email (same rule as
      // loadSessionOrder), via a one-column read run alongside the main one.
      const [messages, owned] = await Promise.all([
        getOrderMessages(orderId),
        identity.role === 'customer' ? orderIdBelongsToEmail(orderId, identity.email) : true,
      ]);
      if (!owned) {
        return res.status(401).json({ error: ORDER_NOT_OWNED_ERROR, code: 'ORDER_NOT_OWNED' });
      }
      // AUDIT-2026-10-06: customers get only the Messages-tab chat (and its
      // replies), with creator emails stripped — see toCustomerMessages()
      // in lib/monday.js. Staff (admin portal) still get everything.
      if (identity.role === 'customer') {
        return res.status(200).json({ messages: toCustomerMessages(messages) });
      }
      return res.status(200).json({ messages });
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
    if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'Message body required.' });

    // AUDIT-2026-10-06: for a customer, load the order BEFORE the write —
    // (1) to re-check it still belongs to the session's email (same rule as
    // lib/apiAuth.js's loadSessionOrder), and (2) so nothing after the
    // write needs an unguarded Monday read. That read used to happen after
    // postOrderMessage(): if it threw, the customer got a 500 for a message
    // that HAD been posted, retried, and posted it twice.
    let customerOrder = null;
    if (identity.role === 'customer') {
      try {
        customerOrder = await getOrderById(orderId);
      } catch (err) {
        console.error('messages POST: failed to load order:', err.message);
        return res.status(500).json({ error: 'Failed to send message.' });
      }
      if (!customerOrder) return res.status(404).json({ error: 'Order not found.' });
      if (!orderMatchesEmail(customerOrder, identity.email)) {
        return res.status(401).json({ error: ORDER_NOT_OWNED_ERROR, code: 'ORDER_NOT_OWNED' });
      }
    }

    let message;
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
      message = await postOrderMessage(orderId, `[PORTAL]${originTag}\n${body.trim()}`);
    } catch (err) {
      console.error('messages POST: postOrderMessage failed:', err.message);
      return res.status(500).json({ error: 'Failed to send message.' });
    }

    // AUDIT-2026-10-06: the message is posted — from here on nothing may turn
    // this into an error response (a retry would post it again). Every
    // follow-up below is individually best-effort.
    try {
      // Notify team + flag the queue when a customer sends a message
      if (identity.role === 'customer') {
        // AUDIT-2026-10-06: a staff member "viewing as customer" types in the
        // customer's voice (the chat bubble stays [PORTAL:CUSTOMER]), but the
        // team email and a separate audit-trail update (tagged "[PORTAL: …]",
        // so never shown in the customer's chat) record who actually sent it.
        if (identity.impersonatedBy) {
          await postTaggedUpdate(orderId, 'PORTAL: Staff Action While Viewing As Customer',
            `${identity.impersonatedBy} sent a Messages-tab message as the customer (${identity.email}) on ${new Date().toLocaleString()}.`
          ).catch(console.error);
        }
        await notifyTeamNewMessage(
          customerOrder?.name || orderId,
          sessionActorLabel(identity),
          body.trim().slice(0, 100)
        ).catch(console.error);
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
    } catch (err) {
      console.error(`messages POST: message posted on order ${orderId}, but a follow-up step failed:`, err);
    }

    // Customers get the same reduced shape GET returns (no creator email).
    const responseMessage = identity.role === 'customer' && message
      ? toCustomerMessages([{ ...message, replies: [] }])[0] || null
      : message;
    return res.status(201).json({ message: responseMessage });
  }

  return res.status(405).end();
}
