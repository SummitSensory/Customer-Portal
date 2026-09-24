import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeSelections, validatePresentSelections, validateColorSelectionData } from './colorSelectionValidation';

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
    // legs is a real Cardinal/Prismatic steel frame part (structure_frame_paint)
    // — see lib/colorRequirements.js.
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
      climbing_wall_color: {
        climbing_wall: { brand: 'cardinal', code: 'T009-BG01', extraField: 'should be dropped', hex: '#ffffff' },
      },
    };
    expect(sanitizeSelections(order, selections)).toEqual({
      climbing_wall_color: { climbing_wall: { brand: 'cardinal', code: 'T009-BG01' } },
    });
  });

  it('drops an entire unrecognized top-level key, no matter its size or shape', () => {
    const selections = {
      climbing_wall_color: { climbing_wall: { brand: 'cardinal', code: 'T009-BG01' } },
      junk: 'x'.repeat(900_000),
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.junk).toBeUndefined();
    expect(JSON.stringify(clean).length).toBeLessThan(200);
  });

  it('drops an unrecognized part key within a known input', () => {
    const selections = {
      climbing_wall_color: {
        climbing_wall: { brand: 'cardinal', code: 'T009-BG01' },
        not_a_real_part: { brand: 'cardinal', code: 'T009-BG01' },
      },
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.climbing_wall_color.not_a_real_part).toBeUndefined();
    expect(clean.climbing_wall_color.climbing_wall).toEqual({ brand: 'cardinal', code: 'T009-BG01' });
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
    // was saved. "legs" under structure_frame_paint is a real part
    // regardless of what productType the order currently shows — see
    // allKnownInputParts() in lib/colorRequirements.js.
    const driftedOrder = { productType: 'Summit Soar: Mobile Free-Standing Swing Frame' };
    const selections = {
      structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } },
    };
    const clean = sanitizeSelections(driftedOrder, selections);
    expect(clean.structure_frame_paint.legs).toEqual({ brand: 'cardinal', code: 'T009-BG01' });
  });
});

// Real incident (2026-09-03): 50 Prismatic SKUs were removed from the live
// catalog that day. Before this fix, every part was re-validated against
// the LIVE catalog on EVERY save/confirm with no exception for a value
// that was already stored and had already passed validation once — so a
// color retired after a customer picked it permanently blocked confirming
// ANY selection that still included it, including autosaves to totally
// UNRELATED parts in the same request. isUnchangedFromStored (internal to
// lib/colorSelectionValidation.js) grandfathers a value that exactly
// matches what's already stored through re-validation; a genuinely NEW or
// CHANGED value must still survive real, live catalog validation.
describe('grandfathering: an already-stored, unchanged selection skips live-catalog re-validation (2026-09-03 retired-SKU incident)', () => {
  const ADVENTURE_SERIES = 'Summit Adventure Series: Custom Sensory Gym';
  // Simulates a real Prismatic SKU that existed and validated fine when the
  // customer first picked it, then was later removed from the catalog —
  // findPrismaticBySku(RETIRED_SKU) returns nothing today, exactly like a
  // real retired SKU would.
  const RETIRED_SKU = 'PRB-DOES-NOT-EXIST-ANYMORE';

  function orderWithStoredRetiredSelection() {
    return {
      productType: ADVENTURE_SERIES,
      colorSelectionSnapshot: {
        selections: {
          structure_frame_paint: {
            legs: { brand: 'prismatic', code: RETIRED_SKU },
            horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
            ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-BG01' },
          },
        },
        confirmedAt: null,
      },
    };
  }

  it('validatePresentSelections does not block an unrelated autosave just because a retired-but-unchanged stored value is present', () => {
    const order = orderWithStoredRetiredSelection();
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: RETIRED_SKU }, // unchanged, re-submitted as-is
        horizontal_beams: { brand: 'cardinal', code: 'P009-BG02' }, // a genuinely new pick on a DIFFERENT part
      },
    };
    expect(validatePresentSelections(order, selections)).toBeNull();
  });

  it('a genuinely CHANGED value for the same part still requires real, live-catalog validation — grandfathering never applies to a new pick', () => {
    const order = orderWithStoredRetiredSelection();
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: 'ANOTHER-FAKE-SKU' }, // different from what's stored
        horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
      },
    };
    expect(validatePresentSelections(order, selections)).toMatch(/legs/);
  });

  it('validateColorSelectionData (confirm) does not block confirming a fully complete order just because one already-saved part was retired from the catalog since it was picked', () => {
    const order = orderWithStoredRetiredSelection();
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: RETIRED_SKU },
        horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
        ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-BG01' },
      },
      climbing_wall_color: { climbing_wall: { brand: 'cardinal', code: 'T009-BG01' } },
      adventure_mat: { adventure_mat_system: { brand: 'vinyl', code: 'Black' } },
      wall_padding_mat: { column_wraps_pads: { brand: 'vinyl', code: 'Black' } },
      slide_platform_paint: { slide_platform: { brand: 'cardinal', code: 'T009-BG01' } },
      slide: { slide_color: { brand: 'plastic', code: 'Blue' } },
      climbing_wall_mat: { climbing_wall_mat: { brand: 'vinyl', code: 'Black' } },
      ball_pit: {
        ball_pit_vinyl: { brand: 'vinyl', code: 'Black' },
      },
    };
    expect(validateColorSelectionData(order, selections)).toBeNull();
  });

  it('confirming still fails if a retired part was NOT already stored (a brand-new submission can never grandfather in)', () => {
    // No colorSelectionSnapshot at all — this is a first-time confirm, so
    // there is nothing to grandfather; the retired SKU must fail exactly
    // as it would have before this fix.
    const freshOrder = { productType: ADVENTURE_SERIES };
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: RETIRED_SKU },
        horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
        ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-BG01' },
      },
      climbing_wall_color: { climbing_wall: { brand: 'cardinal', code: 'T009-BG01' } },
      adventure_mat: { adventure_mat_system: { brand: 'vinyl', code: 'Black' } },
      wall_padding_mat: { column_wraps_pads: { brand: 'vinyl', code: 'Black' } },
      slide_platform_paint: { slide_platform: { brand: 'cardinal', code: 'T009-BG01' } },
      slide: { slide_color: { brand: 'plastic', code: 'Blue' } },
      climbing_wall_mat: { climbing_wall_mat: { brand: 'vinyl', code: 'Black' } },
      ball_pit: {
        ball_pit_vinyl: { brand: 'vinyl', code: 'Black' },
      },
    };
    expect(validateColorSelectionData(freshOrder, selections)).toMatch(/legs/);
  });

  it('sanitizeSelections keeps a grandfathered, unchanged retired selection instead of silently dropping it from what gets persisted', () => {
    const order = orderWithStoredRetiredSelection();
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: RETIRED_SKU },
        horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
      },
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.structure_frame_paint.legs).toEqual({ brand: 'prismatic', code: RETIRED_SKU });
  });

  it('sanitizeSelections still drops a genuinely invalid value that is not an unchanged match of what is stored', () => {
    const order = orderWithStoredRetiredSelection();
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: 'SOME-OTHER-FAKE-SKU' },
      },
    };
    const clean = sanitizeSelections(order, selections);
    expect(clean.structure_frame_paint).toBeUndefined();
  });
});

describe('Foundation System Mat (gate color_mm7c5nq2, catalog sourced 2026-09-22)', () => {
  const order = { productType: 'Summit Soar: Mobile Free-Standing Swing Frame', colorGates: { foundationMat: 'Included' } };

  it('accepts each real Foundation color', () => {
    for (const code of ['Black/Gray', 'Red/Blue', 'Green/Gray']) {
      expect(validatePresentSelections(order, { foundation_mat: { foundation_mat: { brand: 'foundation', code } } })).toBeNull();
    }
  });

  it('rejects an unknown Foundation color and a vinyl color on the Foundation part', () => {
    expect(validatePresentSelections(order, { foundation_mat: { foundation_mat: { brand: 'foundation', code: 'Pink/Purple' } } })).toMatch(/unrecognized Foundation/);
    expect(validatePresentSelections(order, { foundation_mat: { foundation_mat: { brand: 'vinyl', code: 'Black' } } })).toMatch(/must use one of: foundation/);
  });

  it('sanitizeSelections keeps a real Foundation pick', () => {
    const clean = sanitizeSelections(order, { foundation_mat: { foundation_mat: { brand: 'foundation', code: 'Red/Blue' } } });
    expect(clean.foundation_mat.foundation_mat).toEqual({ brand: 'foundation', code: 'Red/Blue' });
  });
});
