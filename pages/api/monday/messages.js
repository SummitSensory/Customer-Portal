/**
 * GET  /api/monday/messages?orderId=...   — get messages for an order
 * POST /api/monday/messages               — post a new message
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderMessages, postOrderMessage, getOrderById, setStatusLabel, postTaggedUpdate } from '../../../lib/monday';
import { notifyTeamNewMessage, sendCustomerReplyNotification } from '../../../lib/email';
import { allowRequest } from '../../../lib/rateLimit';

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
 * EM-11 for a staff reply sent from the Admin Portal Messages tab. This used
 * to be left entirely to update-webhook.js via Monday's "when an update is
 * created" automation — which Monday deactivated on 2026-08-18
 * ("store.webhooks.error.unauthorized") once PORTAL-003 started requiring
 * ?secret= on that endpoint and the automation's saved URL didn't carry it.
 * No portal reply was emailed after that until cron/message-reply-safety-net
 * caught one (Dallas Center Grimes CSD, 2026-10-02). This path knows for
 * certain it's a staff reply, so it sends directly; update-webhook.js now
 * skips [PORTAL] chat posts so the two can't double-send. Posts the same
 * "[PORTAL: Reply Notified]" marker the safety-net cron looks for. Never
 * fails the request — the message is already posted, and a missed email is
 * still caught by that cron.
 */
async function notifyCustomerOfStaffReply(orderId, text) {
  try {
    const order = await getOrderById(orderId);
    if (!order?.customerEmail) return;
    const preview = text.replace(/<[^>]+>/g, '').trim().slice(0, 280);
    if (!preview) return;
    await sendCustomerReplyNotification(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name,
      preview
    );
    await postTaggedUpdate(
      orderId,
      'PORTAL: Reply Notified',
      `Staff reply notification emailed to ${order.customerEmail} on ${new Date().toLocaleDateString()}.`
    ).catch(err => console.error(`Reply notification sent to ${order.customerEmail}, but the "[PORTAL: Reply Notified]" log write FAILED for order ${orderId} — cron/message-reply-safety-net may falsely flag this as a gap:`, err.message));
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

      // Staff replying from the Admin Portal should clear the queue flag and
      // email the customer here — this path doesn't depend on the Monday.com
      // "update created" webhook (see update-webhook.js), so it must do both
      // directly rather than relying on that automation firing.
      if (identity.role === 'staff') {
        await setStatusLabel(orderId, 'messageStatus', 'Replied').catch(console.error);
        await notifyCustomerOfStaffReply(orderId, body.trim());
      }

      return res.status(201).json({ message });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  }

  return res.status(405).end();
}
