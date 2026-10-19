/**
 * GET /api/admin/quickbooks/connect — start connecting QuickBooks (OAuth 2).
 * Staff only. Sends the browser to Intuit's sign-in; Intuit returns to
 * ./callback.js with a code. The random `state` is kept in a short-lived
 * cookie and checked there, so a callback can't be forged from elsewhere.
 */

import { randomBytes } from 'crypto';
import { serialize } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { authorizeUrl, quickbooksConfigured, OAUTH_STATE_COOKIE } from '../../../../lib/quickbooks';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (!quickbooksConfigured()) {
    return res.status(400).json({ error: 'QuickBooks is not set up yet: QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_TOKEN_KEY must be set in Vercel.' });
  }

  const state = randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', serialize(OAUTH_STATE_COOKIE, state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/admin/quickbooks', maxAge: 600,
  }));
  res.redirect(302, authorizeUrl(state));
}
