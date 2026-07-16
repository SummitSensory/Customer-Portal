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

  // Prefill Full Name / Organization / Email — same param keys used by the
  // embedded form in ShowcaseTab (verified against the live Jotform form;
  // its internal field names don't match what it actually reads for prefill).
  const prefill = new URLSearchParams();
  const orgName = order.name ? order.name.split(' - ')[0].trim() : '';
  if (order.contactName) prefill.set('q2_textbox0', order.contactName);
  if (orgName) prefill.set('yourName', orgName);
  if (order.contactEmail) prefill.set('q3_email1', order.contactEmail);
  const prefillQs = prefill.toString();
  const uploadUrl = `https://form.jotform.com/${order.showcaseFormId}${prefillQs ? `?${prefillQs}` : ''}`;

  try {
    await sendUploadLinkEmail(session.email, order.contactName || order.firstName || '', uploadUrl);
  } catch (err) {
    console.error('email-upload-link: send failed:', err);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}
