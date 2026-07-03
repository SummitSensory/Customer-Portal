/**
 * POST /api/auth/verify-code
 * Body: { code }
 * Reads the code cookie, verifies the code, creates a customer session.
 */

import { parse, serialize } from 'cookie';
import {
  verifyCodeToken,
  signCustomerSession,
  CODE_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  clearCookieOptions,
} from '../../../lib/auth';
import { getOrderByEmail } from '../../../lib/monday';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code required.' });

  // Read and verify the code cookie
  const cookies = parse(req.headers.cookie || '');
  const cookieToken = cookies[CODE_COOKIE];
  if (!cookieToken) {
    return res.status(400).json({ error: 'Session expired. Please request a new code.' });
  }

  const payload = await verifyCodeToken(cookieToken);
  if (!payload) {
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }

  if (String(payload.code) !== String(code).trim()) {
    return res.status(401).json({ error: 'Incorrect code. Please try again.' });
  }

  // Look up their order in Monday.com
  let order;
  try {
    order = await getOrderByEmail(payload.email);
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Unable to load order. Please try again.' });
  }

  if (!order) {
    return res.status(404).json({ error: 'No order found for this email address. Please contact Summit Sensory Gym.' });
  }

  // Create a session token
  const sessionToken = await signCustomerSession(payload.email, order.id, order.name);

  // Clear the code cookie, set the session cookie
  res.setHeader('Set-Cookie', [
    serialize(CODE_COOKIE, '', clearCookieOptions()),
    serialize(SESSION_COOKIE, sessionToken, cookieOptions(60 * 60 * 24 * 7)),
  ]);

  return res.status(200).json({ ok: true, orderName: order.name });
}
