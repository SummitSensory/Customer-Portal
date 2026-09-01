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
// Reuses the real endpoint's own validation/pricing functions (already
// exported for its own tests) instead of a second copy — importing a named
// export from another pages/api file is plain JS module resolution and
// does not create a second route; only the file's own path does that.
import { validateColorSelectionData, computeTotalUpcharge } from '../portal/color-selection';

const DEMO_PRODUCT_TYPE = 'Summit Adventure Series: Custom Sensory Gym';

export default async function handler(req, res) {
  const demoOrder = { productType: DEMO_PRODUCT_TYPE };

  if (req.method === 'GET') {
    return res.status(200).json({
      supported: true,
      requiredInputs: requiredColorInputs(DEMO_PRODUCT_TYPE),
      selections: {},
      confirmedAt: null,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { selections, confirm } = req.body || {};
  if (!selections || typeof selections !== 'object') return res.status(400).json({ error: 'selections required.' });

  if (confirm) {
    const validationError = validateColorSelectionData(demoOrder, selections);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  // Deliberately does not persist anywhere — this is the whole point of a
  // demo endpoint. The response shape matches the real one exactly so the
  // picker's own success/error handling behaves identically either way.
  return res.status(200).json({
    ok: true,
    totalUpcharge: computeTotalUpcharge(demoOrder, selections),
    checklistSyncPending: false,
  });
}
