/**
 * Pure validation/pricing logic for color selections — no auth, no session,
 * no Monday.com contact. Used by both the real endpoint
 * (pages/api/portal/color-selection.js) and the sandboxed demo endpoint
 * (pages/api/demo/color-selection.js).
 *
 * Pulled out of pages/api/portal/color-selection.js on 2026-09-01 after a
 * real bug: the demo endpoint imported these functions directly from that
 * file, which transitively imports lib/auth.js — and lib/auth.js throws at
 * MODULE LOAD if NEXTAUTH_SECRET is unset (a deliberate fail-loud check,
 * not a bug in itself). On the Preview deployment used to test this,
 * NEXTAUTH_SECRET turned out not to be configured at all — confirmed via
 * real Vercel runtime error logs, not assumed — which broke the demo page
 * entirely (silently, from the customer's point of view: it just showed
 * "Color selection not yet available," the same empty state as a genuinely
 * unsupported product type, because the failed fetch left requiredInputs
 * at its default []). A route with no business needing auth should never
 * have been able to fail because of an auth secret. This module is the
 * actual fix: neither of these functions needs anything from lib/auth.js,
 * lib/monday.js, or any other module with side effects at import time.
 */

import { requiredColorInputs, allKnownInputParts, ALLOWED_BRANDS } from './colorRequirements';
import { findCardinalByCode, findPrismaticBySku, findVinylByName, findSlideByName, computeLineItemPricing } from './colorCatalog';

/**
 * Validates one part's selection against the real catalog AND against which
 * brand(s) are even allowed on that part — never trusts a client-supplied
 * hex/name/brand, only a catalog id it can look up server-side. Returns an
 * error string, or null if valid.
 */
export function validatePartSelection(inputType, partKey, selection) {
  if (!selection || typeof selection !== 'object') return `A color is required for "${partKey}".`;
  const { brand, code } = selection;
  const allowed = ALLOWED_BRANDS[inputType] || [];
  if (!allowed.includes(brand)) {
    return `"${partKey}" must use one of: ${allowed.join(', ')} (got "${brand}").`;
  }
  if (brand === 'cardinal') {
    if (!code || !findCardinalByCode(code)) return `"${partKey}" has an unrecognized Cardinal color code.`;
    return null;
  }
  if (brand === 'prismatic') {
    if (!code || !findPrismaticBySku(code)) return `"${partKey}" has an unrecognized Prismatic SKU.`;
    return null;
  }
  if (brand === 'vinyl') {
    if (!code || !findVinylByName(code)) return `"${partKey}" has an unrecognized mat/pad color.`;
    return null;
  }
  if (brand === 'plastic') {
    if (!code || !findSlideByName(code)) return `"${partKey}" has an unrecognized Slide color.`;
    return null;
  }
  return `"${partKey}" must specify a valid brand.`;
}

/**
 * True when `value` exactly matches what's already stored in
 * order.colorSelectionSnapshot.selections for this same input/part — i.e.
 * the customer isn't changing this part at all, just re-submitting (via
 * autosave or confirm) a pick that was already saved and already passed
 * live-catalog validation once before.
 *
 * PORTAL bug found 2026-09-03 (real incident: 50 Prismatic SKUs were
 * removed from the catalog that day): every part used to be re-validated
 * against the LIVE catalog on every single save, with no exception for a
 * value that was already stored. That meant a color retired from the
 * catalog AFTER a customer picked it permanently blocked confirming ANY
 * selection that still included it — including autosaves to totally
 * unrelated parts in the same request, since validatePresentSelections/
 * validateColorSelectionData walk every present part on every call, not
 * just the one the customer is actively changing. A genuinely NEW or
 * CHANGED value must still survive live-catalog validation as before —
 * this only grandfathers a value that is IDENTICAL to what's already
 * safely stored.
 */
function isUnchangedFromStored(order, inputKey, part, value) {
  if (!value || typeof value !== 'object') return false;
  const stored = order?.colorSelectionSnapshot?.selections?.[inputKey]?.[part];
  if (!stored || typeof stored !== 'object') return false;
  return stored.brand === value.brand && stored.code === value.code;
}

/**
 * Validates every part that IS present in `selections`, regardless of
 * confirm status — does NOT require completeness. Missing parts are fine
 * here (normal mid-selection state); an invalid catalog code or wrong-
 * category brand is not, ever — unless it's an unchanged, already-stored
 * value (see isUnchangedFromStored above), which is grandfathered through.
 */
export function validatePresentSelections(order, selections) {
  const inputs = requiredColorInputs(order);
  if (!inputs) return `Color selection isn't available yet for product type "${order.productType}".`;

  for (const input of inputs) {
    const inputSelections = selections?.[input.input];
    for (const part of input.parts) {
      const value = inputSelections?.[part];
      if (value == null) continue;
      if (isUnchangedFromStored(order, input.input, part, value)) continue;
      const err = validatePartSelection(input.input, part, value);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Requires every part on every required input to be present and
 * catalog-valid — server is the one that decides "complete," never the
 * client alone. An unchanged, already-stored value (see
 * isUnchangedFromStored above) is grandfathered through without a live
 * catalog re-check; a missing part still fails here exactly as before,
 * since a missing value can never equal a stored one.
 */
export function validateColorSelectionData(order, selections) {
  const inputs = requiredColorInputs(order);
  if (!inputs) return `Color selection isn't available yet for product type "${order.productType}".`;

  for (const input of inputs) {
    const inputSelections = selections?.[input.input];
    for (const part of input.parts) {
      const value = inputSelections?.[part];
      if (isUnchangedFromStored(order, input.input, part, value)) continue;
      const err = validatePartSelection(input.input, part, value);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Rebuilds a clean {inputKey: {partKey: {brand, code}}} object containing
 * ONLY real, known input/part keys, and ONLY the two whitelisted fields off
 * each value — never a spread/copy of the raw client-supplied `selections`.
 * Found by independent code review (2026-09-02): validatePresentSelections/
 * validateColorSelectionData only ever WALK the known keys to check them;
 * neither one rejects extra keys or oversized values sitting alongside
 * them, and the raw object was persisted to Monday's snapshot column as-is.
 * This is the actual enforcement step — anything not in the whitelist is
 * silently dropped before it can ever reach storage, regardless of what the
 * request body contained.
 *
 * Whitelists against allKnownInputParts() — the union across every
 * productType in lib/colorRequirements.js — NOT requiredColorInputs(order.
 * productType) alone. Direct requirement (2026-09-03): whitelisting to only
 * the CURRENT productType meant a productType edit made WHILE a customer
 * was still actively (unconfirmed) picking colors — including a staff typo
 * caught and reverted moments later — would permanently erase real,
 * already-saved selections on the very next autosave, since they'd no
 * longer match the (temporarily) current schema. The whitelist stays just
 * as strict against anything actually arbitrary (every key here still comes
 * from a real, enumerated productType, never from a client) — this only
 * stops a transient/reverted mismatch from destroying real data. What's
 * actually REQUIRED to confirm is unaffected: validateColorSelectionData/
 * requiredColorInputs above are still scoped to the order's CURRENT
 * productType only, so a customer's checklist always reflects what's
 * actually being manufactured for them right now.
 */
export function sanitizeSelections(order, selections) {
  const known = allKnownInputParts();
  const clean = {};
  for (const [inputKey, parts] of Object.entries(known)) {
    for (const part of parts) {
      const value = selections?.[inputKey]?.[part];
      if (!value || typeof value !== 'object' || typeof value.brand !== 'string' || typeof value.code !== 'string') continue;
      // PORTAL-035: this used to accept ANY {brand, code} shape whose values
      // were merely the right TYPE — it never checked brand/code were an
      // actually real, catalog-valid combination, unlike
      // validatePresentSelections/validateColorSelectionData (which only
      // ever check parts belonging to the order's CURRENT productType, by
      // design — see this file's header). For a part that only exists under
      // a DIFFERENT productType (allowed here specifically so a transient
      // productType edit can't destroy real data — see this function's own
      // header), that meant a fabricated code could reach the persisted
      // Monday snapshot having never gone through real validation at all.
      // Running the same validatePartSelection check here — real
      // validation, not just a shape check — means nothing unvalidated is
      // ever written, regardless of which productType's part it belongs to.
      //
      // Same isUnchangedFromStored grandfather exemption as
      // validatePresentSelections/validateColorSelectionData above, and for
      // the same reason (2026-09-03 retired-SKU incident) — without it here
      // too, those two functions grandfathering a retired-but-unchanged
      // value through confirm would be pointless: this whitelist rebuild
      // would still independently re-validate it against the live catalog
      // and silently drop it, leaving a "confirmed" order missing a part it
      // actually has a real, previously-valid selection for.
      if (!isUnchangedFromStored(order, inputKey, part, value) && validatePartSelection(inputKey, part, value)) continue;
      if (!clean[inputKey]) clean[inputKey] = {};
      clean[inputKey][part] = { brand: value.brand, code: value.code };
    }
  }
  return clean;
}

// Delegates to computeLineItemPricing (lib/colorCatalog.js) and sums its
// per-line amounts, rather than re-deriving the Prismatic count in a
// second, separately-written loop — a real duplication the code review
// flagged (the two could drift if the pricing rule changed in only one
// place). This is now the one place the rule actually lives.
export function computeTotalUpcharge(order, selections) {
  const inputs = requiredColorInputs(order) || [];
  return computeLineItemPricing(inputs, selections).reduce((sum, line) => sum + line.amount, 0);
}
