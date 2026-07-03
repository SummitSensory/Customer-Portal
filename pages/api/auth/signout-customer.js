import { serialize } from 'cookie';
import { SESSION_COOKIE, clearCookieOptions } from '../../../lib/auth';

export default function handler(req, res) {
  res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, '', clearCookieOptions()));
  res.redirect(307, '/');
}
