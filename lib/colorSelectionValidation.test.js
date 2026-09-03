import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeSelections } from './colorSelectionValidation';

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

// Real gap found by independent code review (2026-09-02): validation only
// ever WALKS the known input/part keys to check them — it never rejects
// extra keys or oversized values sitting alongside them, and the raw
// `selections` object was persisted to Monday's snapshot column verbatim.
// sanitizeSelections is the actual enforcement: rebuild a clean object with
// only real, known keys/fields, so a malformed or oversized payload can
// never reach storage regardless of what a request body contained.
//
// Whitelists against the UNION of every productType's real shape
// (allKnownInputParts()), not just order.productType alone — direct
// requirement (2026-09-03): a productType edited on Monday while a
// customer is still actively (unconfirmed) editing, including a staff
// typo caught and reverted moments later, must not permanently erase real,
// already-saved selections just because they don't match the (temporarily)
// current productType. The whitelist itself is unweakened — every
// surviving key still has to be a real combination from SOME actual
// productType in lib/colorRequirements.js, never anything a client
// invents.
describe('sanitizeSelections', () => {
  const order = { productType: 'Summit Adventure Series: Custom Sensory Gym' };

  it('keeps only recognized input/part keys and only the brand/code fields off each value', () => {
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'cardinal', code: 'T009-BG01', extraField: 'should be dropped', hex: '#ffffff' },
      },
    };
    expect(sanitizeSelections(order, selections)).toEqual({
      structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } },
    });
  });

  it('drops an entire unrecognized top-level key, no matter its size or shape', () => {
    const selections = {
      structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } },
      junk: 'x'.repeat(900_000),
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.junk).toBeUndefined();
    expect(JSON.stringify(clean).length).toBeLessThan(200);
  });

  it('drops an unrecognized part key within a known input', () => {
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'cardinal', code: 'T009-BG01' },
        not_a_real_part: { brand: 'cardinal', code: 'T009-BG01' },
      },
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.structure_frame_paint.not_a_real_part).toBeUndefined();
    expect(clean.structure_frame_paint.legs).toEqual({ brand: 'cardinal', code: 'T009-BG01' });
  });

  it('drops a value whose brand/code are not both real strings, instead of persisting a malformed entry', () => {
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'cardinal', code: 123 },
        horizontal_beams: { brand: null, code: 'T009-BG01' },
        ladder_rungs_and_leg: 'not even an object',
      },
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.structure_frame_paint).toBeUndefined();
  });

  it('returns an empty object for missing/empty selections rather than throwing', () => {
    expect(sanitizeSelections(order, {})).toEqual({});
    expect(sanitizeSelections(order, null)).toEqual({});
  });

  it('still drops an entirely fabricated input/part combination, even under an unsupported productType — the whitelist is global, not "anything goes when productType is unrecognized"', () => {
    const unsupportedOrder = { productType: 'Not A Real Product Type' };
    const selections = { made_up_input: { made_up_part: { brand: 'cardinal', code: 'T009-BG01' } } };
    expect(sanitizeSelections(unsupportedOrder, selections)).toEqual({});
  });

  it('preserves a real selection through a productType mismatch instead of erasing it — the actual fix for the 2026-09-03 requirement', () => {
    // Simulates the real scenario: a customer's order is (temporarily, or
    // permanently) showing a DIFFERENT productType than when this selection
    // was saved. "legs" under structure_frame_paint is a real part under
    // Adventure Series regardless of what productType the order currently
    // shows — see allKnownInputParts() in lib/colorRequirements.js.
    const driftedOrder = { productType: 'Summit Soar: Mobile Free-Standing Swing Frame' };
    const selections = {
      structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } },
    };
    const clean = sanitizeSelections(driftedOrder, selections);
    expect(clean.structure_frame_paint.legs).toEqual({ brand: 'cardinal', code: 'T009-BG01' });
  });
});
