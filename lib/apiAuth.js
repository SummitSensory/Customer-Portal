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
import { getOrderById, orderMatchesEmail } from './monday';
import { allowRequest } from './rateLimit';

/**
 * Verifies the customer session from the request's cookies. On failure,
 * already writes the 401 response and returns null — callers must `return`
 * immediately when this returns null, exactly like every check below.
 *
 * AUDIT-2026-10-06: the returned session always carries `impersonatedBy`
 * (the staff email for a session minted by /api/admin/impersonate, else
 * null) so write routes can attribute actions — see staffAttribution().
 */
export async function requireCustomerSession(req, res) {
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  return { ...session, impersonatedBy: session.impersonatedBy || null };
}

/**
 * AUDIT-2026-10-06: text appended to Monday audit updates / team emails for
 * a write made during a staff "view as customer" session, so it is never
 * mistaken for the customer's own action. '' for a genuine customer session.
 */
export function staffAttribution(session) {
  return session?.impersonatedBy
    ? ` (done by staff ${session.impersonatedBy} while viewing as customer)`
    : '';
}

/** Who did this, for team-notification emails: the customer email, plus the staff attribution when impersonating. */
export function sessionActorLabel(session) {
  return `${session?.email || 'unknown customer'}${staffAttribution(session)}`;
}

/**
 * AUDIT-2026-10-06: an order-scoped write from a tab that was opened for a
 * DIFFERENT order than the one this browser's session is now bound to (the
 * customer switched orders in another tab — the cookie is shared) would
 * otherwise silently land on the newly-selected order. The frontend sends
 * the orderId it is displaying; when present and different from
 * session.orderId, reject before doing anything. Absent → allowed (backward
 * compatible with tabs opened before the frontend started sending it).
 * Writes a 409 and returns false on mismatch.
 */
export const ORDER_MISMATCH_ERROR = 'This order is no longer the active order in this browser. Please reload.';

export function rejectOrderMismatch(req, session, res) {
  const requested = req.body?.orderId;
  if (requested === undefined || requested === null || requested === '') return true;
  if (String(requested) !== String(session?.orderId ?? '')) {
    res.status(409).json({ error: ORDER_MISMATCH_ERROR, code: 'ORDER_MISMATCH' });
    return false;
  }
  return true;
}

/**
 * AUDIT-2026-10-06: a session is signed with (email, orderId) at login and
 * trusted for 7 days — if staff re-point that order's "Email Address" at a
 * different customer in Monday (a corrected typo, an order moved between
 * organizations), the old customer kept full access to it until the cookie
 * expired. Re-checked on every order load with orderMatchesEmail(), the SAME
 * predicate getOrdersByEmail() uses to decide which orders an email may log
 * into, so a customer who could log in to an order can never be rejected
 * here. Impersonation sessions carry the order's own customer email, so
 * they pass the same way.
 */
export const ORDER_NOT_OWNED_ERROR = 'This order is no longer linked to your account. Please sign in again.';

export function sessionOwnsOrder(session, order) {
  return orderMatchesEmail(order, session?.email);
}

/**
 * Loads the order bound to a verified session's orderId. On failure,
 * already writes the appropriate error response (400/401/404/500) and returns
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
    // AUDIT-2026-10-06: see sessionOwnsOrder() above.
    if (!sessionOwnsOrder(session, order)) {
      console.warn(`${logPrefix || 'loadSessionOrder'}: session email no longer matches order ${order.id}'s customer email — rejecting.`);
      res.status(401).json({ error: ORDER_NOT_OWNED_ERROR, code: 'ORDER_NOT_OWNED' });
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
