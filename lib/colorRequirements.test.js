import { describe, it, expect } from 'vitest';
import { requiredColorInputs, isColorSelectionSupported, allKnownInputParts, COLOR_INPUT } from './colorRequirements';

describe('color requirements manifest — exact-label matching', () => {
  // These are the REAL, full Monday productType labels confirmed live on
  // the Manufacturing Process board (color_mkvw7b8) — see
  // claude-project-docs/build-and-fix-2026-08-27.md #6. Short forms like
  // "Summit Adventure Series" must NOT match; that exact bug already broke
  // 4 of 5 real Jotform routes in production once.

  it('recognizes the real Adventure Series label', () => {
    const inputs = requiredColorInputs('Summit Adventure Series: Custom Sensory Gym');
    expect(inputs).not.toBeNull();
    expect(inputs[0].parts).toEqual([
      'legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'slide_platform', 'slide_color', 'climbing_wall',
    ]);
  });

  it('does NOT match the short form that already caused a production bug', () => {
    expect(requiredColorInputs('Summit Adventure Series')).toBeNull();
  });

  it('recognizes both active Flex labels', () => {
    expect(requiredColorInputs('Summit Flex: Universal Exercise Unit')).not.toBeNull();
    expect(requiredColorInputs('Summit Flex: Universal Exercise Unit & Accessories')).not.toBeNull();
  });

  it('Soar requires only the Soar frame, never other structural parts', () => {
    const inputs = requiredColorInputs('Summit Soar: Mobile Free-Standing Swing Frame');
    expect(inputs[0].parts).toEqual(['soar_frame']);
  });

  it('fails closed (null) for an unrecognized productType, never a default/empty list', () => {
    expect(requiredColorInputs('Something Not Real')).toBeNull();
    expect(requiredColorInputs('')).toBeNull();
    expect(requiredColorInputs(undefined)).toBeNull();
  });

  it('is case-sensitive, exact-string — no normalization', () => {
    expect(requiredColorInputs('summit adventure series: custom sensory gym')).toBeNull();
  });

  it('supports Therapy Mats & Pads now that real vinyl swatch data exists', () => {
    const inputs = requiredColorInputs('Therapy Mats & Pads');
    expect(inputs).not.toBeNull();
    expect(inputs[0].input).toBe(COLOR_INPUT.MAT_PAD_COLOR);
    expect(inputs[0].parts).toEqual(['mat_pad']);
  });

  it('does not yet claim support for product lines with no real sourced data', () => {
    // Ball Pit / Ball Pit Balls / Foundation / Palisades are deliberately
    // absent until real color data (or, for Ball Pit Balls, a product
    // decision) exists — this guards against someone "helpfully" adding a
    // stub entry ahead of that.
    expect(isColorSelectionSupported('Ball Pit')).toBe(false);
    expect(isColorSelectionSupported('Ball Pit Balls')).toBe(false);
  });

  it('every returned input is a recognized COLOR_INPUT type', () => {
    const inputs = requiredColorInputs('Summit Adventure Series: Custom Sensory Gym');
    for (const i of inputs) {
      expect(Object.values(COLOR_INPUT)).toContain(i.input);
    }
  });
});

// Direct requirement (2026-09-03): sanitizeSelections (lib/
// colorSelectionValidation.js) needs a bounded, fully-known whitelist that
// spans every productType, not just one order's current productType — see
// that module's own header comment for the real bug this fixes (a
// productType edit mid-session silently erasing real, unconfirmed
// selections).
describe('allKnownInputParts', () => {
  it('unions parts across every productType that shares the same input key', () => {
    const merged = allKnownInputParts();
    // structure_frame_paint appears under 4 different productTypes with 4
    // different part sets (Adventure Series's 6 parts, Soar's soar_frame,
    // Flex's flex_frame twice) — the union must contain all of them.
    expect(merged[COLOR_INPUT.STRUCTURE_FRAME_PAINT]).toEqual(
      expect.arrayContaining(['legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'slide_platform', 'slide_color', 'climbing_wall', 'soar_frame', 'flex_frame'])
    );
  });

  it('includes mat_pad_color even though it belongs to a completely different productType', () => {
    const merged = allKnownInputParts();
    expect(merged[COLOR_INPUT.MAT_PAD_COLOR]).toEqual(['mat_pad']);
  });

  it('never fabricates an input/part combination not present in any real productType', () => {
    const merged = allKnownInputParts();
    expect(merged.made_up_input).toBeUndefined();
    expect(merged[COLOR_INPUT.STRUCTURE_FRAME_PAINT]).not.toContain('made_up_part');
  });
});
