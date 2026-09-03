/**
 * Shared customer-portal API route boilerplate: session verification, order
 * loading, and rate limiting. Extracted 2026-09-03 after independent code
 * review flagged pages/api/portal/color-selection.js and pages/api/portal/
 * setup.js as separately reimplementing the identical cookie-parse ->
 * verifyCustomerSession -> 401 pattern, and a near-identical order-load
 * pattern — the exact class of drift risk this codebase has already been
 * bitten by once (see lib/messageOrigin.js's own header for the same
 * reasoning applied to a different shared concern).
 *
 * Deliberately three small, independently-callable functions rather than
 * one all-in-one wrapper: the two real callers use these in genuinely
 * different orders (color-selection.js loads the order before branching on
 * GET/POST and only rate-limits the POST path; setup.js rejects a non-POST
 * method before ever touching the session or the order, and rate-limits
 * before its own POST-body validation). Forcing one fixed sequence would
 * have meant changing real, intentional behavior in one route just to fit
 * the other's shape — this only removes the actual duplicated
 * IMPLEMENTATION, not each route's own control flow.
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from './auth';
import { getOrderById } from './monday';
import { allowRequest } from './rateLimit';

/**
 * Verifies the customer session from the request's cookies. On failure,
 * already writes the 401 response and returns null — callers must `return`
 * immediately when this returns null, exactly like every check below.
 */
export async function requireCustomerSession(req, res) {
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  return session;
}

/**
 * Loads the order bound to a verified session's orderId. On failure,
 * already writes the appropriate error response (400/404/500) and returns
 * null. `logPrefix` is optional so each caller's error logs stay
 * distinguishable in Vercel's runtime logs, matching the convention already
 * used by every other route in this codebase (e.g. "color-selection: ...").
 *
 * The explicit `!session.orderId` check (real requirement — every customer
 * session is always created WITH an orderId, see signCustomerSession in
 * lib/auth.js, so this only fires for a genuinely anomalous/corrupted
 * session) is new to pages/api/portal/setup.js as of this extraction: that
 * route previously had no equivalent guard and would have let
 * getOrderById(undefined) behave however Monday's API happens to respond
 * to a missing item id, rather than fail with a clear message. Strictly
 * more correct, zero behavior change for the normal case where orderId is
 * always present.
 */
export async function loadSessionOrder(session, res, { logPrefix } = {}) {
  if (!session.orderId) {
    res.status(400).json({ error: 'No order selected for this session.' });
    return null;
  }
  try {
    const order = await getOrderById(session.orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return null;
    }
    return order;
  } catch (err) {
    if (logPrefix) console.error(`${logPrefix}: failed to load order:`, err.message);
    res.status(500).json({ error: 'Failed to load order.' });
    return null;
  }
}

/**
 * Enforces a per-route rate limit keyed on the caller-supplied key (each
 * route still picks its own key prefix and {maxRequests, windowMs} — see
 * lib/rateLimit.js's own header on why these are route-specific, not a
 * single global number). On failure, already writes the 429 response and
 * returns false.
 */
export function enforceRateLimit(res, key, opts) {
  if (!allowRequest(key, opts)) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    return false;
  }
  return true;
}
