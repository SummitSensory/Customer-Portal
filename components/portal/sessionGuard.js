/**
 * AUDIT-2026-10-06 (follow-up): every order-bound customer API now answers
 * 401 { code: 'ORDER_NOT_OWNED' } once the order a session is bound to has
 * been re-pointed at a different customer email in Monday. That can surface
 * from any of a dozen fetches spread across the portal's tabs, and the right
 * response is always the same — the session is no longer good for this
 * order, so sign out and start over. Navigating to '/' alone isn't enough:
 * the cookie is still a valid session, so the login page's session-check
 * would bounce straight back to /portal. Going through the sign-out route
 * clears the cookie first (it then redirects to '/').
 *
 * Installed once by the portal page; wraps window.fetch so individual
 * callers don't each need to know about this. Only same-origin /api/ calls
 * that come back 401 are inspected (via a clone, so the caller's own body
 * read is untouched).
 */

export const SIGN_OUT_URL = '/api/auth/signout-customer';

export async function isOrderNotOwnedResponse(res) {
  if (!res || res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.code === 'ORDER_NOT_OWNED';
  } catch {
    return false;
  }
}

function isSameOriginApiCall(input) {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.startsWith('/api/')) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** Returns an uninstall function. `onLost` defaults to a full navigation through sign-out. */
export function installOrderOwnershipGuard(onLost = () => window.location.assign(SIGN_OUT_URL)) {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {};
  const originalFetch = window.fetch;
  let fired = false;

  window.fetch = async function guardedFetch(input, init) {
    const res = await originalFetch.call(this, input, init);
    if (!fired && isSameOriginApiCall(input) && await isOrderNotOwnedResponse(res)) {
      fired = true;
      onLost();
    }
    return res;
  };

  return () => {
    if (window.fetch.name === 'guardedFetch') window.fetch = originalFetch;
  };
}
