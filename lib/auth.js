/**
 * Auth utilities for customer email-code login.
 * Stateless: the verification token is a signed JWT stored in an HTTP-only cookie.
 */

import { SignJWT, jwtVerify } from 'jose';
import { randomInt, createHash, timingSafeEqual } from 'crypto';

// PORTAL-001: There is no safe fallback for the session-signing secret — if
// NEXTAUTH_SECRET is ever unset (misconfigured Vercel env, fresh deploy,
// local dev without a .env), every customer AND staff session in this app
// is signed/verified with a fixed, publicly-known string, letting anyone
// forge a valid session token. Fail loudly at module load instead of
// silently falling back, so a missing secret is caught in deployment/build
// rather than surfacing later as an authentication bypass in production.
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error(
    'NEXTAUTH_SECRET is not set. Refusing to start with an insecure fallback signing secret — set NEXTAUTH_SECRET in the environment before running this app.'
  );
}
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

// ── Code generation ───────────────────────────────────────────────────────────

/**
 * Generate a 6-digit numeric code.
 * PORTAL-008: Math.random() is not cryptographically secure and its output
 * is predictable given enough samples, which matters here because this code
 * is the sole factor protecting a customer login. crypto.randomInt() is a
 * CSPRNG-backed replacement with the same [100000, 999999] range.
 */
export function generateCode() {
  return String(randomInt(100000, 1000000));
}

// PORTAL-030: signCodeToken used to put the literal 6-digit code in the JWT
// payload. A JWS (what SignJWT produces) is SIGNED, not ENCRYPTED — its
// payload is plain base64url, readable by anyone holding the cookie with no
// secret required. Since send-code.js sets this cookie on the REQUESTER'S
// OWN browser before the code is ever opened in an inbox, anyone who knew a
// target's order email could POST send-code, read the code straight out of
// the Set-Cookie response, and log in as that customer without ever touching
// their inbox — a full authentication bypass. Storing a SHA-256 hash of the
// code instead means the cookie never contains anything the real code can be
// recovered from; verify-code.js can still confirm a guess is correct
// without the token ever revealing what it's checking against.
function hashCode(code) {
  return createHash('sha256').update(String(code)).digest();
}

/**
 * Sign a JWT containing the email + a hash of the code, expiring in 10
 * minutes. `attempts` (PORTAL-008) tracks failed verification attempts
 * against this specific code so verify-code.js can lock a code out after too
 * many wrong guesses, instead of allowing unlimited retries against a
 * 6-digit space.
 */
export async function signCodeToken(email, code, attempts = 0) {
  return signCodeHashToken(email, hashCode(code).toString('hex'), attempts);
}

/**
 * Re-signs a code token carrying an ALREADY-COMPUTED hash — used only to
 * bump the attempts counter after a wrong guess (verify-code.js), never to
 * re-derive or expose the original code.
 */
export async function signCodeHashToken(email, codeHash, attempts = 0) {
  return new SignJWT({ email, codeHash, attempts })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET);
}

/**
 * Constant-time check that a user-submitted code matches the hash embedded
 * in a verified token payload. Returns false (never throws) for a
 * malformed/missing hash.
 */
export function codeMatchesHash(submittedCode, codeHash) {
  if (typeof codeHash !== 'string' || !codeHash) return false;
  let stored;
  try {
    stored = Buffer.from(codeHash, 'hex');
  } catch {
    return false;
  }
  const submitted = hashCode(submittedCode);
  if (stored.length !== submitted.length) return false;
  return timingSafeEqual(stored, submitted);
}

/** Maximum wrong-code attempts allowed against a single issued code. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Constant-time comparison for a webhook shared secret. Several webhook
 * routes (invite-webhook.js, update-webhook.js, accessory-webhook.js)
 * compared the provided secret with plain `!==`, which short-circuits on
 * the first mismatched byte — a timing side-channel, low practical risk
 * over the public internet but real and cheap to close, and inconsistent
 * with the AfterShip webhook's own constant-time check. Always returns
 * false (never throws) for a missing/malformed value.
 */
export function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Verify and decode the code token */
export async function verifyCodeToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload; // { email, codeHash, attempts, iat, exp }
  } catch {
    return null;
  }
}

// ── Session token ─────────────────────────────────────────────────────────────

/** Create a customer session token (7-day expiry) */
export async function signCustomerSession(email, orderId, orderName) {
  return new SignJWT({ email, orderId, orderName, role: 'customer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET);
}

/**
 * Create a customer session token on behalf of staff ("view/act as customer").
 * Deliberately short-lived (2 hours, vs. the customer's own 7-day session) and
 * carries `impersonatedBy` so the portal UI can show a persistent banner and
 * every action taken during the session can be traced back to the staff member
 * who started it, not mistaken for the customer's own action.
 */
export async function signImpersonationSession(email, orderId, orderName, staffEmail) {
  return new SignJWT({ email, orderId, orderName, role: 'customer', impersonatedBy: staffEmail })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(SECRET);
}

/** Verify a customer session token */
export async function verifyCustomerSession(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export const CODE_COOKIE = 'summit_code_token';
export const SESSION_COOKIE = 'summit_customer_session';

export function cookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function clearCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 };
}

/** Parse cookies from a request header string */
export function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

// ── Staff domain check ────────────────────────────────────────────────────────

export function isStaffEmail(email = '') {
  // STAFF_EMAIL_DOMAIN may be a single domain OR a comma-separated list,
  // e.g. "summitsensory.com,summitsensorygym.com".
  const raw = process.env.STAFF_EMAIL_DOMAIN || 'summitsensory.com,summitsensorygym.com';
  const domains = raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const addr = (email || '').toLowerCase().trim();
  return domains.some(d => addr.endsWith(`@${d}`));
}
