/**
 * POST /api/portal/email-upload-link
 * Emails the signed-in customer a direct link to the Photo & Video Showcase
 * upload form, so they can open it on their phone without re-logging into
 * the portal. Reduces mobile upload friction (no SMS provider needed).
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { sendUploadLinkEmail } from '../../../lib/email';
import { enforceRateLimit, loadSessionOrder } from '../../../lib/apiAuth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // PORTAL-036: this route sends a real email but, unlike every other
  // email-triggering endpoint in the app (send-code.js, setup.js,
  // color-selection.js), had no rate limit at all — a valid customer
  // session could loop this to trigger unlimited outbound Resend sends.
  if (!enforceRateLimit(res, `email-upload-link:${session.email}`, { maxRequests: 5, windowMs: 60_000 })) return;

  // loadSessionOrder also rejects a session whose order's email was changed
  // by staff since login (audit 2026-10-18) — otherwise the old contact got
  // a link prefilled with the new contact's name and email.
  const order = await loadSessionOrder(session, res, { logPrefix: 'email-upload-link' });
  if (!order) return;

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
