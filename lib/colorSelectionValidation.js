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
import { findCardinalByCode, findPrismaticBySku, findVinylByName, computeLineItemPricing } from './colorCatalog';

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
  return `"${partKey}" must specify a valid brand.`;
}

/**
 * Validates every part that IS present in `selections`, regardless of
 * confirm status — does NOT require completeness. Missing parts are fine
 * here (normal mid-selection state); an invalid catalog code or wrong-
 * category brand is not, ever.
 */
export function validatePresentSelections(order, selections) {
  const inputs = requiredColorInputs(order.productType);
  if (!inputs) return `Color selection isn't available yet for product type "${order.productType}".`;

  for (const input of inputs) {
    const inputSelections = selections?.[input.input];
    for (const part of input.parts) {
      const value = inputSelections?.[part];
      if (value == null) continue;
      const err = validatePartSelection(input.input, part, value);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Requires every part on every required input to be present and
 * catalog-valid — server is the one that decides "complete," never the
 * client alone.
 */
export function validateColorSelectionData(order, selections) {
  const inputs = requiredColorInputs(order.productType);
  if (!inputs) return `Color selection isn't available yet for product type "${order.productType}".`;

  for (const input of inputs) {
    const inputSelections = selections?.[input.input];
    for (const part of input.parts) {
      const err = validatePartSelection(input.input, part, inputSelections?.[part]);
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
      if (value && typeof value === 'object' && typeof value.brand === 'string' && typeof value.code === 'string') {
        if (!clean[inputKey]) clean[inputKey] = {};
        clean[inputKey][part] = { brand: value.brand, code: value.code };
      }
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
  const inputs = requiredColorInputs(order.productType) || [];
  return computeLineItemPricing(inputs, selections).reduce((sum, line) => sum + line.amount, 0);
}
