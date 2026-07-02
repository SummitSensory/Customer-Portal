/**
 * GET /api/auth/session-check
 * Quick check: does the customer have a valid session cookie?
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';

export default async function handler(req, res) {
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (session) return res.status(200).json({ ok: true, email: session.email });
  return res.status(200).json({ ok: false });
}
