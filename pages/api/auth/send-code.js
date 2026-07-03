/**
 * POST /api/auth/send-code
 * Body: { email }
 * Generates a 6-digit login code, signs it into a cookie JWT, sends code by email.
 */

import { serialize } from 'cookie';
import { generateCode, signCodeToken, CODE_COOKIE, cookieOptions } from '../../../lib/auth';
import { sendLoginCode } from '../../../lib/email';
import { getOrderByEmail } from '../../../lib/monday';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Verify an order exists for this email before sending a code
  try {
    const order = await getOrderByEmail(normalizedEmail);
    if (!order) {
      // Return success anyway to avoid email enumeration
      return res.status(200).json({ sent: true });
    }
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    // Continue anyway — don't block login on Monday API errors
  }

  const code = generateCode();
  const token = await signCodeToken(normalizedEmail, code);

  // Send code by email
  try {
    await sendLoginCode(normalizedEmail, code);
  } catch (err) {
    console.error('Email send error:', err.message);
    return res.status(500).json({ error: 'Failed to send login email. Please try again.' });
  }

  // Set the signed token in a secure cookie (10-minute TTL)
  res.setHeader('Set-Cookie', serialize(CODE_COOKIE, token, cookieOptions(60 * 10)));
  return res.status(200).json({ sent: true });
}
