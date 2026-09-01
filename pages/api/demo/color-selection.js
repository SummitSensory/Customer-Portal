/**
 * GET/POST /api/demo/color-selection — sandboxed twin of
 * /api/portal/color-selection for pages/portal/color-preview.js.
 *
 * No auth, no session, no Monday.com contact of any kind — this exists
 * purely so Bryan can click through the real ColorSelectionTab component
 * (not a rebuilt copy of it) before the real backend is wired to a live
 * Monday column. Reuses the SAME validation logic the real endpoint uses,
 * so what you see here behaves identically to what customers will
 * eventually get — it just never writes anywhere real.
 *
 * Not linked from anywhere in the customer-facing app. Safe to leave in
 * place after launch as a standing demo/training surface, or delete once
 * it's no longer useful — it has no dependency on live data to go stale.
 */

import { requiredColorInputs } from '../../../lib/colorRequirements';
// Imports from lib/colorSelectionValidation.js, NOT from
// pages/api/portal/color-selection.js — that file pulls in lib/auth.js,
// which throws at import time if NEXTAUTH_SECRET is unset. This route has
// no business needing that at all; see the lib module's header comment for
// the real, confirmed bug that came from getting this wrong the first time.
import { validateColorSelectionData, computeTotalUpcharge } from '../../../lib/colorSelectionValidation';

const DEMO_PRODUCT_TYPE = 'Summit Adventure Series: Custom Sensory Gym';

// In-memory only — resets on cold start/redeploy, never touches Monday.com.
// This exists so the demo can actually PROVE the "cannot be modified once
// submitted" rule works (confirm here, then try to change it) rather than
// just asserting it in copy. Module-scope state is fine for a single-user
// click-through demo; it is never meant to be a real multi-user store.
let demoSnapshot = { selections: {}, confirmedAt: null };

export default async function handler(req, res) {
  const demoOrder = { productType: DEMO_PRODUCT_TYPE };

  if (req.method === 'GET') {
    return res.status(200).json({
      supported: true,
      requiredInputs: requiredColorInputs(DEMO_PRODUCT_TYPE),
      selections: demoSnapshot.selections,
      confirmedAt: demoSnapshot.confirmedAt,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Mirrors the real endpoint's hard lock: once confirmed, no further
  // writes, autosave included.
  if (demoSnapshot.confirmedAt) {
    return res.status(409).json({
      error: 'Color selections were already confirmed and cannot be changed. Contact us if you need to make a correction.',
      confirmedAt: demoSnapshot.confirmedAt,
    });
  }

  const { selections, confirm } = req.body || {};
  if (!selections || typeof selections !== 'object') return res.status(400).json({ error: 'selections required.' });

  if (confirm) {
    const validationError = validateColorSelectionData(demoOrder, selections);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  demoSnapshot = {
    selections,
    confirmedAt: confirm ? new Date().toISOString() : null,
  };

  return res.status(200).json({
    ok: true,
    totalUpcharge: computeTotalUpcharge(demoOrder, selections),
    checklistSyncPending: false,
  });
}

// Reset hook for local/demo convenience — not exposed as a route, just
// importable by tests that want a clean slate between cases.
export function __resetDemoSnapshot() {
  demoSnapshot = { selections: {}, confirmedAt: null };
}
