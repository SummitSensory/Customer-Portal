/**
 * Auth utilities for customer email-code login.
 * Stateless: the verification token is a signed JWT stored in an HTTP-only cookie.
 */

import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback-dev-secret-change-this');

// ── Code generation ───────────────────────────────────────────────────────────

/** Generate a 6-digit numeric code */
export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Sign a JWT containing the email + code, expiring in 10 minutes */
export async function signCodeToken(email, code) {
  return new SignJWT({ email, code })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET);
}

/** Verify and decode the code token */
export async function verifyCodeToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload; // { email, code, iat, exp }
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
