/**
 * POST /api/auth/verify-code
 * Body: { code }
 * Reads the code cookie, verifies the code, creates a customer session.
 */

import { parse, serialize } from 'cookie';
import {
  verifyCodeToken,
  signCodeToken,
  signCustomerSession,
  CODE_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  clearCookieOptions,
  MAX_CODE_ATTEMPTS,
} from '../../../lib/auth';
import { getOrdersByEmail } from '../../../lib/monday';

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

  // PORTAL-008: cap wrong-code guesses against this issued code. Without
  // this, a 6-digit code is guessable in a bounded number of requests since
  // nothing else throttled attempts. Once the limit is hit, the code cookie
  // is cleared so the customer must request a fresh code.
  const attemptsSoFar = Number(payload.attempts) || 0;
  if (attemptsSoFar >= MAX_CODE_ATTEMPTS) {
    res.setHeader('Set-Cookie', serialize(CODE_COOKIE, '', clearCookieOptions()));
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  if (String(payload.code) !== String(code).trim()) {
    // Re-sign the cookie with the incremented attempt count so the limit
    // above is enforced across requests without needing server-side state.
    const nextToken = await signCodeToken(payload.email, payload.code, attemptsSoFar + 1);
    res.setHeader('Set-Cookie', serialize(CODE_COOKIE, nextToken, cookieOptions(60 * 10)));
    return res.status(401).json({ error: 'Incorrect code. Please try again.' });
  }

  // Look up every order tied to this email in Monday.com.
  // PORTAL-007: this previously called getOrderByEmail() (singular), which
  // always resolves to just the most-recently-created order, and always
  // bound the session to that one orderId. A customer/organization with more
  // than one order at Summit Sensory Gym could never reach any order except
  // their newest — the multi-order "which order would you like to access?"
  // picker (OrderPicker in pages/portal/index.js) and /api/monday/order's
  // own multi-order GET branch already existed but were unreachable dead
  // code, since a session always carried a fixed orderId. Now: bind the
  // session to a specific order only when there's exactly one; otherwise
  // leave orderId unset so /api/monday/order's GET falls through to its
  // getOrdersByEmail() branch and the picker actually gets used.
  let orders;
  try {
    orders = await getOrdersByEmail(payload.email);
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Unable to load order. Please try again.' });
  }

  if (!orders.length) {
    return res.status(404).json({ error: 'No order found for this email address. Please contact Summit Sensory Gym.' });
  }

  const singleOrder = orders.length === 1 ? orders[0] : null;
  const sessionToken = singleOrder
    ? await signCustomerSession(payload.email, singleOrder.id, singleOrder.name)
    : await signCustomerSession(payload.email, undefined, undefined);

  // Clear the code cookie, set the session cookie
  res.setHeader('Set-Cookie', [
    serialize(CODE_COOKIE, '', clearCookieOptions()),
    serialize(SESSION_COOKIE, sessionToken, cookieOptions(60 * 60 * 24 * 7)),
  ]);

  return res.status(200).json({
    ok: true,
    orderName: singleOrder ? singleOrder.name : null,
    multipleOrders: !singleOrder,
  });
}
