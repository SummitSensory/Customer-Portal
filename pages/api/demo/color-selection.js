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

import { parse, serialize } from 'cookie';
import { randomUUID } from 'crypto';
import { requiredColorInputs } from '../../../lib/colorRequirements';
// Imports from lib/colorSelectionValidation.js, NOT from
// pages/api/portal/color-selection.js — that file pulls in lib/auth.js,
// which throws at import time if NEXTAUTH_SECRET is unset. This route has
// no business needing that at all; see the lib module's header comment for
// the real, confirmed bug that came from getting this wrong the first time.
import { validateColorSelectionData, computeTotalUpcharge } from '../../../lib/colorSelectionValidation';

const DEMO_PRODUCT_TYPE = 'Summit Adventure Series: Custom Sensory Gym';
const VIEWER_COOKIE = 'summit_demo_viewer';

// In-memory only — resets on cold start/redeploy, never touches Monday.com.
// Keyed per-viewer (a random id in a same-origin cookie, not tied to any
// real identity) rather than one shared module-scope object. Found by
// independent code review (2026-09-02): a single shared snapshot meant any
// two people who opened /color-preview at the same time (two prospects
// shown the demo, a colleague testing while someone else demos it live)
// clobbered each other's picks, and the moment either one confirmed, the
// SAME shared snapshot locked (409) for every other visitor until a cold
// start/redeploy cleared it — a global outage triggered by any single
// viewer, on a page whose whole purpose is being safe to click through.
const demoSnapshots = new Map();
const VIEWER_COOKIE_MAX_AGE_MS = 60 * 60 * 24 * 1000;

function emptySnapshot() {
  return { selections: {}, confirmedAt: null, lastSeenAt: Date.now() };
}

export default async function handler(req, res) {
  const demoOrder = { productType: DEMO_PRODUCT_TYPE };

  const cookies = parse(req.headers.cookie || '');
  let viewerId = cookies[VIEWER_COOKIE];
  if (!viewerId) {
    viewerId = randomUUID();
    res.setHeader('Set-Cookie', serialize(VIEWER_COOKIE, viewerId, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: VIEWER_COOKIE_MAX_AGE_MS / 1000,
    }));
  }
  const demoSnapshot = demoSnapshots.get(viewerId) || emptySnapshot();

  // Real gap found by independent code review (2026-09-02): unlike
  // lib/rateLimit.js's own bucket map (which sweeps once it exceeds 5000
  // keys), this one had no eviction at all — a bot/crawler hitting this
  // public, unauthenticated page repeatedly without keeping the viewer
  // cookie creates a permanent new entry every time, growing unbounded on
  // a long-lived warm instance. Mirrors that same sweep pattern: once past
  // a size threshold, drop anything a viewer's own cookie could no longer
  // reach anyway (older than the cookie's own maxAge).
  if (demoSnapshots.size > 2000) {
    const cutoff = Date.now() - VIEWER_COOKIE_MAX_AGE_MS;
    for (const [id, snap] of demoSnapshots) {
      if ((snap.lastSeenAt || 0) < cutoff) demoSnapshots.delete(id);
    }
  }

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

  demoSnapshots.set(viewerId, {
    selections,
    confirmedAt: confirm ? new Date().toISOString() : null,
    lastSeenAt: Date.now(),
  });

  return res.status(200).json({
    ok: true,
    totalUpcharge: computeTotalUpcharge(demoOrder, selections),
    checklistSyncPending: false,
  });
}

// Reset hook for local/demo convenience — not exposed as a route, just
// importable by tests that want a clean slate between cases.
export function __resetDemoSnapshot() {
  demoSnapshots.clear();
}
