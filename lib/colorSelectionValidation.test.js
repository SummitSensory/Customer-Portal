import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Regression test for a real bug (found via a live report on the preview
// deployment, 2026-09-01): pages/api/demo/color-selection.js used to import
// validateColorSelectionData/computeTotalUpcharge from the REAL
// pages/api/portal/color-selection.js, which imports lib/auth.js — and
// lib/auth.js throws at module load if NEXTAUTH_SECRET is unset. On the
// deployment where this was actually hit, NEXTAUTH_SECRET turned out not
// to be configured at all (confirmed via Vercel's real runtime logs), so
// the demo page's initial fetch failed on every load — with no auth logic
// of its own ever being exercised, and no visible reason why to whoever
// was looking at it.
//
// vitest.setup.js sets a dummy NEXTAUTH_SECRET globally so every OTHER
// test file can import anything that touches lib/auth.js. This file
// deliberately unsets it and dynamically re-imports, proving the demo
// route's actual dependency chain (lib/colorSelectionValidation.js ->
// lib/colorRequirements.js / lib/colorCatalog.js) has no hidden coupling
// to auth at all — the exact property that was missing before.
describe('lib/colorSelectionValidation — no hidden auth dependency (regression)', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it('imports cleanly with NEXTAUTH_SECRET completely unset', async () => {
    const mod = await import('./colorSelectionValidation.js?no-auth-check');
    expect(typeof mod.validateColorSelectionData).toBe('function');
    expect(typeof mod.computeTotalUpcharge).toBe('function');
  });

  it('actually works end to end with NEXTAUTH_SECRET unset — not just importable', async () => {
    const { computeTotalUpcharge } = await import('./colorSelectionValidation.js?no-auth-check');
    const order = { productType: 'Summit Adventure Series: Custom Sensory Gym' };
    const selections = { structure_frame_paint: { legs: { brand: 'prismatic', code: 'PRB-10395' } } };
    expect(computeTotalUpcharge(order, selections)).toBe(500);
  });
});
