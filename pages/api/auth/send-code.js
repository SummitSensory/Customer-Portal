/**
 * POST /api/auth/send-code
 * Body: { email }
 * Generates a 6-digit login code, signs it into a cookie JWT, sends code by email.
 */

import { serialize } from 'cookie';
import { generateCode, signCodeToken, CODE_COOKIE, cookieOptions } from '../../../lib/auth';
import { sendLoginCode } from '../../../lib/email';
import { getOrderByEmail } from '../../../lib/monday';
import { allowRequest, getClientIp } from '../../../lib/rateLimit';

// PORTAL-041: the "real order" path awaits a real Resend send before
// responding; the "no order" path used to return immediately after. Even
// with identical response BODIES (PORTAL-019), that latency gap is itself a
// distinguishable oracle for whether an email has a real order. Padding
// every response out to this floor (only ever waiting LONGER, never
// shorter) closes the gap whenever the real send is faster than the floor.
// Set above Resend's typical send latency (real-world API calls to Resend
// are almost always well under 1.5s; this session verified their status
// page shows no elevated-latency incidents) rather than just "a few hundred
// ms," specifically so this closes the gap in the large majority of real
// requests, not just the fast-path ones — 2s is a deliberately generous
// floor, trading a slightly slower login response for actually closing the
// oracle most of the time. It still can't close the gap on the rare request
// where Resend itself is slower than 2s; a hard architectural limit of
// coupling the response to a real external call, not something worth
// solving by decoupling them (that would mean silently swallowing a real
// send failure instead of telling the customer to retry).
const MIN_RESPONSE_MS = 2000;

async function respondAfterFloor(startedAt, send) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
  }
  return send();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const startedAt = Date.now();

  // PORTAL-027: this is the single most abusable endpoint in the app — fully
  // unauthenticated by design, and each call sends a real email. See
  // lib/rateLimit.js for the in-memory limiter's scope/limitations.
  if (!allowRequest(`send-code:${getClientIp(req)}`, { maxRequests: 5, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Verify an order exists for this email before sending a code
  try {
    const order = await getOrderByEmail(normalizedEmail);
    if (!order) {
      // PORTAL-019: previously returned {sent:true} with NO code cookie set,
      // "to avoid email enumeration" — but that just moved the leak one
      // step later: verify-code.js then returns a different error for "no
      // cookie" ("Session expired") than for "wrong code against a real
      // cookie" ("Incorrect code"), so the two cases were still
      // distinguishable from the very next request. Still sign and set a
      // code cookie here (against a code nobody was actually sent), so the
      // subsequent verify-code response is identical either way — the
      // eventual "Incorrect code" result reveals nothing about whether the
      // email had a real order.
      const dummyCode = generateCode();
      const dummyToken = await signCodeToken(normalizedEmail, dummyCode);
      res.setHeader('Set-Cookie', serialize(CODE_COOKIE, dummyToken, cookieOptions(60 * 10)));
      return respondAfterFloor(startedAt, () => res.status(200).json({ sent: true }));
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
  return respondAfterFloor(startedAt, () => res.status(200).json({ sent: true }));
}
