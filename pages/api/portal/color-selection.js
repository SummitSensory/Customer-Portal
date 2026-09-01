/**
 * GET  /api/portal/color-selection — read the caller's saved selections +
 *                                     the required-input checklist for their order
 * POST /api/portal/color-selection — save one or more part/color choices,
 *                                     optionally confirming the whole input as complete
 *
 * Phase 1 scope: Structure & Frame Paint (Cardinal/Prismatic) and Mat & Pad
 * Color (vinyl), for the product types listed in lib/colorRequirements.js.
 * Every other product line keeps using the existing Jotform flow
 * (pages/api/jotform/webhook.js) unchanged until it migrates in a later
 * phase — see claude-project-docs's Color Selection Implementation Plan, §11.
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderById, postTaggedUpdate, markSectionCompleteSafe, writeColorSelectionSnapshot } from '../../../lib/monday';
import { allowRequest } from '../../../lib/rateLimit';
import { requiredColorInputs, COLOR_INPUT, ALLOWED_BRANDS } from '../../../lib/colorRequirements';
import { findCardinalByCode, findPrismaticBySku, findVinylByName, prismaticUpcharge } from '../../../lib/colorCatalog';

/**
 * Validates one part's selection against the real catalog AND against which
 * brand(s) are even allowed on that part — never trusts a client-supplied
 * hex/name/brand, only a catalog id it can look up server-side. Returns an
 * error string, or null if valid.
 *
 * FIXED (found in independent code review, 2026-09-01): previously checked
 * only "is this code real within whichever brand the client claims" — a Mat
 * & Pad Color selection using a real, valid Prismatic PAINT SKU passed and
 * could be confirmed, because nothing checked that vinyl is the only brand
 * allowed on a mat/pad part. Now takes the owning input type so it can
 * reject a wrong-category brand before ever consulting a catalog.
 */
function validatePartSelection(inputType, partKey, selection) {
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
 * `confirm` — does NOT require completeness. Missing parts are fine here
 * (that's normal mid-selection state); an invalid catalog code or wrong-
 * category brand is not, ever, autosave or not.
 *
 * FIXED (found in independent code review, 2026-09-01): validation used to
 * run only when confirm was true, so a fabricated code (e.g.
 * {brand:'prismatic', code:'FAKE-SKU'}) sent on an ordinary autosave was
 * written straight to Monday and priced via computeTotalUpcharge with no
 * check at all — a real, staff-visible dollar figure computed from data
 * nothing had verified was real.
 */
function validatePresentSelections(order, selections) {
  const inputs = requiredColorInputs(order.productType);
  if (!inputs) return `Color selection isn't available yet for product type "${order.productType}".`;

  for (const input of inputs) {
    const inputSelections = selections?.[input.input];
    for (const part of input.parts) {
      const value = inputSelections?.[part];
      if (value == null) continue; // absence is fine on autosave — completeness is checked separately
      const err = validatePartSelection(input.input, part, value);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Mirrors validateSetupData()'s shape in pages/api/portal/setup.js: returns
 * a plain error string, or null if the submission is fully valid. Requires
 * every part on every required input to be present and catalog-valid —
 * server is the one that decides "complete," never the client alone (see
 * the Color Selection Experience doc, §20).
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

export function computeTotalUpcharge(order, selections) {
  const inputs = requiredColorInputs(order.productType) || [];
  let prismaticCount = 0;
  for (const input of inputs) {
    if (input.input !== COLOR_INPUT.STRUCTURE_FRAME_PAINT) continue;
    for (const part of input.parts) {
      if (selections?.[input.input]?.[part]?.brand === 'prismatic') prismaticCount++;
    }
  }
  return prismaticUpcharge(prismaticCount);
}

export default async function handler(req, res) {
  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (!session.orderId) return res.status(400).json({ error: 'No order selected for this session.' });

  let order;
  try {
    order = await getOrderById(session.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
  } catch (err) {
    console.error('color-selection: failed to load order:', err.message);
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  if (req.method === 'GET') {
    const inputs = requiredColorInputs(order.productType);
    return res.status(200).json({
      supported: !!inputs,
      requiredInputs: inputs || [],
      selections: order.colorSelectionSnapshot?.selections || {},
      confirmedAt: order.colorSelectionSnapshot?.confirmedAt || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  if (!allowRequest(`color-selection:${session.email}`, { maxRequests: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { selections, confirm } = req.body || {};
  if (!selections || typeof selections !== 'object') return res.status(400).json({ error: 'selections required.' });

  // Every present part is validated on every save, autosave included — an
  // invalid/wrong-category code is never accepted, priced, or persisted
  // regardless of confirm. Only COMPLETENESS (every required part present)
  // is confirm-gated, matching §09/§13 of the Experience doc (save early
  // and often; confirmation is the one moment that requires everything).
  const presentSelectionsError = validatePresentSelections(order, selections);
  if (presentSelectionsError) return res.status(400).json({ error: presentSelectionsError });

  if (confirm) {
    const validationError = validateColorSelectionData(order, selections);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  const totalUpcharge = computeTotalUpcharge(order, selections);
  const wasAlreadyConfirmed = !!order.colorSelectionSnapshot?.confirmedAt;
  const snapshot = {
    selections,
    totalUpcharge,
    confirmedAt: confirm ? new Date().toISOString() : (order.colorSelectionSnapshot?.confirmedAt || null),
  };

  try {
    await writeColorSelectionSnapshot(order.id, snapshot);
  } catch (err) {
    console.error('color-selection: snapshot write failed:', err.message);
    return res.status(500).json({ error: 'Error saving. Please try again.' });
  }

  if (confirm) {
    await postTaggedUpdate(
      order.id,
      'PORTAL: Color Selections',
      `Customer confirmed color/finish selections on ${new Date().toLocaleDateString()}. Total upcharge: $${totalUpcharge}.`
    ).catch(console.error);

    const synced = await markSectionCompleteSafe(order.id, 'portalColors');
    return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: !synced });
  }

  // KNOWN GAP, documented rather than silently shipped: this endpoint does
  // not yet block or route post-confirmation edits through a "pending
  // correction" flow the way the Contact tab does for its own locked
  // fields (Color Selection Experience doc §10, tier: Strongly
  // Recommended, not required for Phase 1). Full parity with that pattern
  // is real follow-up work, not something to rush under time pressure.
  // What this DOES guarantee in the meantime: staff is never left unaware
  // that an already-confirmed selection changed — every such autosave still
  // posts a visible tagged update, so it shows up in the order's activity
  // feed even though the picker doesn't yet show the customer an explicit
  // "editing a confirmed selection" state.
  if (wasAlreadyConfirmed) {
    await postTaggedUpdate(
      order.id,
      'PORTAL: Color Selections Changed After Confirmation',
      `Customer modified color/finish selections on ${new Date().toLocaleDateString()}, after already confirming them. New total upcharge: $${totalUpcharge}. Please review before manufacturing.`
    ).catch(console.error);
  }

  return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: false });
}
