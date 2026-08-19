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
