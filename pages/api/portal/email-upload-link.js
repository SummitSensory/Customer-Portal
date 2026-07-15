/**
 * POST /api/portal/email-upload-link
 * Emails the signed-in customer a direct link to the Photo & Video Showcase
 * upload form, so they can open it on their phone without re-logging into
 * the portal. Reduces mobile upload friction (no SMS provider needed).
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById } from '../../../lib/monday';
import { sendUploadLinkEmail } from '../../../lib/email';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  let order;
  try {
    order = await getOrderById(session.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
  } catch (err) {
    console.error('email-upload-link: failed to load order:', err);
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  if (!order.showcaseFormId) {
    return res.status(400).json({ error: 'Upload form is not set up yet. Please contact us directly.' });
  }

  const uploadUrl = `https://form.jotform.com/${order.showcaseFormId}`;

  try {
    await sendUploadLinkEmail(session.email, order.contactName || order.firstName || '', uploadUrl);
  } catch (err) {
    console.error('email-upload-link: send failed:', err);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}
