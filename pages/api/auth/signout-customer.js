import { serialize } from 'cookie';
import { SESSION_COOKIE, clearCookieOptions } from '../../../lib/auth';

// Clears the customer session cookie, which is also where a staff "View as
// Customer" (impersonation) session lives. Needs no session of any kind, so
// the admin page can call it with fetch (POST) right before its own NextAuth
// sign-out; without that, an impersonation session stayed live for up to 2
// hours on the staff member's browser after they signed out of admin (audit
// 2026-10-09). A plain link (GET) still redirects home as before.
export default function handler(req, res) {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, '', clearCookieOptions()));
  if (req.method === 'GET') return res.redirect(307, '/');
  return res.status(200).json({ ok: true });
}
