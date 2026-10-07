/**
 * POST /api/client-error
 * Receives errors from the browser (pages/_app.js: window errors, unhandled
 * promise rejections, React render crashes) and forwards them to
 * lib/errorAlerts.js — the same urgent email to Bryan server errors get.
 *
 * Unauthenticated by necessity (a crash can happen before or without a
 * session), so it's rate limited per IP, every field is length-capped, and
 * the email template escapes everything. The signed-in user is looked up
 * from the session cookie, never trusted from the body.
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../lib/auth';
import { allowRequest, getClientIp } from '../../lib/rateLimit';
import { reportError } from '../../lib/errorAlerts';

// Browser noise that isn't a portal bug: cross-origin scripts (extensions,
// Google Maps) report only "Script error.", and ResizeObserver loop warnings
// are benign.
const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i];

const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

async function whoIsThis(req, res) {
  try {
    const staff = await getServerSession(req, res, authOptions);
    if (staff?.user?.email) return `staff: ${staff.user.email}`;
    const customer = await verifyCustomerSession(parse(req.headers.cookie || '')[SESSION_COOKIE]);
    if (customer?.email) return `customer: ${customer.email} (order ${customer.orderId})`;
  } catch { /* best effort */ }
  return 'not signed in';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!allowRequest(`client-error:${getClientIp(req)}`, { maxRequests: 10, windowMs: 60_000 })) {
    return res.status(429).end();
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const message = cap(body.message, 2000);
  if (!message || IGNORED.some(re => re.test(message))) return res.status(204).end();

  console.warn('Browser error reported:', message);
  // AUDIT-2026-10-06: its own (smaller) hourly email budget — anyone can POST
  // here, and sharing the server budget let junk reports use it up and
  // silence real server-error alerts. See lib/errorAlerts.js.
  await reportError({
    budget: 'client',
    source: `browser ${cap(body.kind, 40) || 'error'}`,
    message,
    stack: cap(body.stack, 8000),
    context: {
      page: cap(body.url, 500),
      user: await whoIsThis(req, res),
      browser: cap(req.headers['user-agent'], 300),
      componentStack: cap(body.componentStack, 4000),
    },
  });
  return res.status(204).end();
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
