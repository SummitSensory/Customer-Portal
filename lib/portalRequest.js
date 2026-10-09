/**
 * Shared request guards for the customer portal's write endpoints
 * (pages/api/portal/setup.js, pages/api/portal/color-selection.js).
 */

/**
 * The session cookie is shared by every browser tab, so switching orders in
 * one tab (POST /api/auth/select-order) re-binds the session for all of
 * them. A save from a tab still showing the previous order used to land on
 * whichever order the cookie now pointed at — order A's address or colors
 * written onto order B with a 200 (audit 2026-10-09). The client now sends
 * the order it is showing; a mismatch is rejected with 409 so it can reload.
 *
 * A missing orderId is still accepted (a browser holding a page from before
 * this deploy) — logged so the fallback can be removed once it stops showing.
 *
 * Returns true when it has already responded (caller should return).
 */
export function rejectOrderMismatch(res, session, orderId, logPrefix) {
  if (orderId == null || orderId === '') {
    console.warn(`${logPrefix}: write without orderId (stale client?) — using session order ${session.orderId}`);
    return false;
  }
  if (String(orderId) === String(session.orderId)) return false;
  res.status(409).json({
    error: 'You switched to a different order in another tab. This page will reload to show the current order.',
    code: 'ORDER_MISMATCH',
  });
  return true;
}

/**
 * Suffix for audit-trail updates and team emails when staff are acting
 * through "View as Customer" (signImpersonationSession), so their actions
 * aren't recorded as the customer's own. Empty string for a real customer.
 */
export function staffActorNote(session) {
  return session?.impersonatedBy
    ? ` (entered by staff ${session.impersonatedBy} while viewing as customer)`
    : '';
}
