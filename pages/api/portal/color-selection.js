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
import { requiredColorInputs } from '../../../lib/colorRequirements';
import { validatePresentSelections, validateColorSelectionData, computeTotalUpcharge, sanitizeSelections } from '../../../lib/colorSelectionValidation';
import { reportCriticalFailure } from '../../../lib/monitoring';

// Re-exported for anything still importing these two from this file's own
// module (kept for the existing test suite's import paths) — the real
// implementations now live in lib/colorSelectionValidation.js, which has no
// auth/session/Monday dependency, specifically so pages/api/demo/color-
// selection.js can use the exact same validation without inheriting this
// file's NEXTAUTH_SECRET requirement (see that module's header comment for
// the real bug this fixes).
export { validateColorSelectionData, computeTotalUpcharge };

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

  // Real gap found by independent code review (2026-09-02): every single
  // swatch click autosaves (see handlePartChange in ColorSelectionTab.js) —
  // unlike the other routes sharing lib/rateLimit.js's default (a form
  // submitted once, or an email-triggering action worth throttling hard), a
  // customer legitimately comparing colors across 131 Cardinal + 428
  // Prismatic options can easily click through more than 20 in a minute.
  // The 20/min default hitting a normal browsing session isn't a hardened
  // limit, it's a false positive that silently reverted the customer's last
  // pick with no retry. This route doesn't send email and can only ever
  // touch the caller's own order (session-bound), so a much higher ceiling
  // is safe here — still a real backstop against a runaway client loop,
  // just sized for how this specific endpoint is actually used.
  if (!allowRequest(`color-selection:${session.email}`, { maxRequests: 100, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  // Locked the moment confirmedAt is set — matches what the customer was
  // told before they confirmed ("This Cannot Be Undone"). The picker UI
  // (ConfirmedView) already refuses to render an editable form once this is
  // true, but the client can't be trusted to enforce that alone: this is
  // the actual guarantee. No autosave, no re-confirm, no exceptions — a
  // customer who needs a change after confirming contacts staff, same as
  // any other locked portal field.
  if (order.colorSelectionSnapshot?.confirmedAt) {
    return res.status(409).json({
      error: 'Color selections were already confirmed and cannot be changed. Contact us if you need to make a correction.',
      confirmedAt: order.colorSelectionSnapshot.confirmedAt,
    });
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

  // Real gap found by independent code review (2026-09-02): validation above
  // only ever inspects the known input/part keys — it never rejects extra
  // top-level keys or oversized values a client might include alongside
  // them, and the whole `selections` object was persisted verbatim into
  // Monday's long-text snapshot column. Rebuilding a clean object here,
  // keeping only the exact {brand, code} shape for exactly the parts this
  // order's productType actually has, means nothing but that ever reaches
  // Monday regardless of what a request body actually contained.
  const cleanSelections = sanitizeSelections(order, selections);

  const totalUpcharge = computeTotalUpcharge(order, cleanSelections);
  const snapshot = {
    selections: cleanSelections,
    totalUpcharge,
    confirmedAt: confirm ? new Date().toISOString() : null,
  };

  // Real race found by independent code review (2026-09-02): the
  // confirmedAt check above reads `order` from the top of this request —
  // there's no compare-and-swap on a Monday text column, so two requests
  // that both start before either write lands (two tabs, a duplicated/
  // retried request) can both pass that check. Re-reading immediately
  // before the write narrows that window down to the gap between this read
  // and the write itself, instead of the whole request's duration — as
  // close to atomic as this architecture allows.
  if (!confirm) {
    let freshOrder;
    try {
      freshOrder = await getOrderById(order.id);
    } catch (err) {
      console.error('color-selection: re-check before save failed:', err.message);
      return res.status(500).json({ error: 'Error saving. Please try again.' });
    }
    if (freshOrder?.colorSelectionSnapshot?.confirmedAt) {
      return res.status(409).json({
        error: 'Color selections were already confirmed and cannot be changed. Contact us if you need to make a correction.',
        confirmedAt: freshOrder.colorSelectionSnapshot.confirmedAt,
      });
    }
  }

  try {
    await writeColorSelectionSnapshot(order.id, snapshot);
  } catch (err) {
    console.error('color-selection: snapshot write failed:', err.message);
    return res.status(500).json({ error: 'Error saving. Please try again.' });
  }

  if (confirm) {
    // Real gap found by independent code review (2026-09-02): this used to
    // be `.catch(console.error)` — the one write in this whole confirm path
    // that could fail silently with no signal to staff at all, unlike
    // every other write here (which either fails the request or reports
    // via checklistSyncPending). The snapshot write and the completion
    // flag are the two things that actually matter to the customer/business
    // logic and have already succeeded by this point, so a failure here
    // must not turn a real, successful confirmation into an error response
    // — but staff still need to know the audit-trail update never landed,
    // via the same alerting path already used for other silent-failure
    // classes in this codebase (markSectionCompleteSafe, cron runs).
    let auditUpdatePending = false;
    try {
      await postTaggedUpdate(
        order.id,
        'PORTAL: Color Selections',
        `Customer confirmed color/finish selections on ${new Date().toLocaleDateString()}. Total upcharge: $${totalUpcharge}.`
      );
    } catch (err) {
      auditUpdatePending = true;
      await reportCriticalFailure(
        'color-selection-confirm',
        `Order ${order.id} confirmed color selections, but the audit-trail update to Monday failed.`,
        { orderId: order.id, error: err.message }
      );
    }

    const synced = await markSectionCompleteSafe(order.id, 'portalColors');
    return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: !synced, auditUpdatePending });
  }

  return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: false });
}
