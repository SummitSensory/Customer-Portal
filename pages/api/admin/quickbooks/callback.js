/**
 * GET /api/admin/quickbooks/callback — Intuit returns here after a staff
 * member approves the connection (see ./connect.js). Checks `state`, trades
 * the code for tokens, stores them encrypted (lib/quickbooks.js), and sends
 * the browser back to the admin page.
 */

import { parse, serialize } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { completeConnection, OAUTH_STATE_COOKIE as STATE_COOKIE } from '../../../../lib/quickbooks';
import { secretsMatch } from '../../../../lib/auth';

function back(res, outcome) {
  res.setHeader('Set-Cookie', serialize(STATE_COOKIE, '', { path: '/api/admin/quickbooks', maxAge: 0 }));
  res.redirect(302, `/admin?quickbooks=${encodeURIComponent(outcome)}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { code, realmId, state, error } = req.query || {};
  if (error) return back(res, `error: ${error}`);
  const expected = parse(req.headers.cookie || '')[STATE_COOKIE];
  if (!expected || !state || !secretsMatch(String(state), expected)) return back(res, 'error: the sign-in expired or did not match — try Connect again');
  if (!code || !realmId) return back(res, 'error: QuickBooks did not return a company');

  try {
    await completeConnection({ code: String(code), realmId: String(realmId), connectedBy: session.user?.email || 'unknown staff' });
    return back(res, 'connected');
  } catch (err) {
    console.error('quickbooks callback: connecting failed:', err.message);
    return back(res, `error: ${err.message}`);
  }
}
