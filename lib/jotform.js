/**
 * Shared Jotform helpers used by more than one portal tab (ColorTab's
 * embedded product forms and ShowcaseTab's photo/video upload form).
 * Split out so ShowcaseTab can be code-split via next/dynamic (see
 * components/portal/ShowcaseTab.js) without needing to duplicate this
 * validation logic — pages/portal/index.js and the split-out tab component
 * both import from here, so there's exactly one implementation to keep in
 * sync.
 */
export function isValidJotformId(id) {
  return typeof id === 'string' && /^[0-9]{5,20}$/.test(id);
}

/**
 * Appends the signed `portal_order_token` (order.formOrderToken, from
 * /api/monday/order) to a Jotform URL. Each form has a hidden field with
 * that unique name, which Jotform prefills from the matching URL parameter;
 * the webhook then binds the submission to that order rather than trusting
 * the typed-in email (audit 2026-10-09). No token → the URL is unchanged.
 */
export function withOrderToken(url, token) {
  if (!url || !token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}portal_order_token=${encodeURIComponent(token)}`;
}
