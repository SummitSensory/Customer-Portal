import { describe, it, expect } from 'vitest';
import {
  requiredColorInputs, isColorSelectionSupported, allKnownInputParts,
  unbuiltRequiredColorGates, COLOR_INPUT,
} from './colorRequirements';

const ADVENTURE_SERIES = 'Summit Adventure Series: Custom Sensory Gym';
const SOAR = 'Summit Soar: Mobile Free-Standing Swing Frame';
const FLEX = 'Summit Flex: Universal Exercise Unit';
const FLEX_ACCESSORIES = 'Summit Flex: Universal Exercise Unit & Accessories';

// Every buildable gate "Included" — the fail-closed default when
// order.colorGates is entirely absent (e.g. an order predating these
// Monday columns), matching this file's long-standing "never silently
// skip a real requirement" policy.
function allIncludedOrder(productType) {
  return { productType };
}

describe('color requirements manifest — exact-label matching', () => {
  // These are the REAL, full Monday productType labels confirmed live on
  // the Manufacturing Process board (color_mkvw7b8) — see
  // claude-project-docs/build-and-fix-2026-08-27.md #6. Short forms like
  // "Summit Adventure Series" must NOT match; that exact bug already broke
  // 4 of 5 real Jotform routes in production once.

  it('does NOT match the short form that already caused a production bug', () => {
    expect(requiredColorInputs(allIncludedOrder('Summit Adventure Series'))).toBeNull();
  });

  it('recognizes both active Flex labels', () => {
    expect(requiredColorInputs(allIncludedOrder(FLEX))).not.toBeNull();
    expect(requiredColorInputs(allIncludedOrder(FLEX_ACCESSORIES))).not.toBeNull();
  });

  it('fails closed (null) for an unrecognized productType, never a default/empty list', () => {
    expect(requiredColorInputs(allIncludedOrder('Something Not Real'))).toBeNull();
    expect(requiredColorInputs(allIncludedOrder(''))).toBeNull();
    expect(requiredColorInputs({ productType: undefined })).toBeNull();
    expect(requiredColorInputs(null)).toBeNull();
  });

  it('is case-sensitive, exact-string — no normalization', () => {
    expect(requiredColorInputs(allIncludedOrder('summit adventure series: custom sensory gym'))).toBeNull();
  });

  it('supports Therapy Mats & Pads now that real vinyl swatch data exists', () => {
    const inputs = requiredColorInputs(allIncludedOrder('Therapy Mats & Pads'));
    expect(inputs).not.toBeNull();
    expect(inputs[0].input).toBe(COLOR_INPUT.MAT_PAD_COLOR);
    expect(inputs[0].parts).toEqual(['mat_pad']);
  });

  it('does not claim support for product lines with no real sourced data', () => {
    expect(isColorSelectionSupported('Ball Pit')).toBe(false);
    expect(isColorSelectionSupported('Ball Pit Balls')).toBe(false);
    expect(isColorSelectionSupported('Foundation')).toBe(false);
  });
});

// 2026-09-21 redesign: Adventure/Soar/Flex now share one flat set of
// independently-gated inputs, driven by Bryan's "Color Selection Decision
// Tree" — not a static per-productType list.
describe('gate-driven requirements (Bryan\'s decision tree, 2026-09-21)', () => {
  it('with no colorGates/colorFrameType set (order predates these columns), every buildable gate AND the steel frame are required — fail closed, not fail open', () => {
    const inputs = requiredColorInputs(allIncludedOrder(ADVENTURE_SERIES));
    const keys = inputs.map((i) => i.input);
    expect(keys).toEqual(expect.arrayContaining([
      COLOR_INPUT.STRUCTURE_FRAME_PAINT, COLOR_INPUT.ADVENTURE_MAT, COLOR_INPUT.CLIMBING_WALL, COLOR_INPUT.CLIMBING_WALL_MAT,
      COLOR_INPUT.WALL_PADDING, COLOR_INPUT.BALL_PIT, COLOR_INPUT.SLIDE,
    ]));
    // Not-yet-buildable gates (Ball Pit Balls, Foundation) never appear in
    // requiredInputs even when "Included" — see the buildable test below
    // and unbuiltRequiredColorGates.
    expect(keys).not.toContain(COLOR_INPUT.BALL_PIT_BALLS);
    expect(keys).not.toContain(COLOR_INPUT.FOUNDATION_MAT);
  });

  it('Slide is buildable (real catalog sourced 2026-09-21: Blue/Green/Gray) — plastic, not vinyl', () => {
    const inputs = requiredColorInputs(allIncludedOrder(ADVENTURE_SERIES));
    const slide = inputs.find((i) => i.input === COLOR_INPUT.SLIDE);
    expect(slide).toBeTruthy();
    expect(slide.parts).toEqual(['slide_platform', 'slide_color']);
  });

  // Direct requirement (2026-09-21), after a real back-and-forth: Product
  // Type (colorFrameType) restores the ORIGINAL Cardinal/Prismatic steel
  // frame parts, unconditional whenever a real frame type applies — NOT
  // vinyl, despite Column D's "Vinyl" label on the *-Mat Color columns
  // (those are a separate, independently-gated vinyl item — see below).
  it('the steel frame (Cardinal/Prismatic) is driven by colorFrameType and restores the original per-frame-type parts', () => {
    expect(requiredColorInputs({ productType: ADVENTURE_SERIES, colorFrameType: 'Adventure' })
      .find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT).parts)
      .toEqual(['legs', 'horizontal_beams', 'ladder_rungs_and_leg']);
    expect(requiredColorInputs({ productType: SOAR, colorFrameType: 'Soar' })
      .find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT).parts)
      .toEqual(['soar_frame']);
    expect(requiredColorInputs({ productType: FLEX, colorFrameType: 'Flex' })
      .find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT).parts)
      .toEqual(['flex_frame']);
  });

  it('colorFrameType "N/A" means no steel frame color at all, even for a real frame-type productType', () => {
    const inputs = requiredColorInputs({ productType: ADVENTURE_SERIES, colorFrameType: 'N/A' });
    expect(inputs.find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT)).toBeUndefined();
  });

  it('an unset/unrecognized colorFrameType falls back to inferring the frame from productType — never silently drops the steel frame', () => {
    const inputs = requiredColorInputs({ productType: SOAR }); // no colorFrameType at all
    const steel = inputs.find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT);
    expect(steel).toBeTruthy();
    expect(steel.parts).toEqual(['soar_frame']);
  });

  it('Zip Line is vinyl, folded into Adventure-Mat Color — NOT part of the Cardinal/Prismatic steel frame (direct requirement, 2026-09-21)', () => {
    const inputs = requiredColorInputs(allIncludedOrder(ADVENTURE_SERIES));
    const adventureMat = inputs.find((i) => i.input === COLOR_INPUT.ADVENTURE_MAT);
    expect(adventureMat).toBeTruthy();
    expect(adventureMat.parts).toEqual(['zip_line']);
    const steel = inputs.find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT);
    expect(steel.parts).not.toContain('zip_line');
  });

  it('Climbing Wall is its own independent Cardinal/Prismatic gate, separate from the steel frame', () => {
    const inputs = requiredColorInputs(allIncludedOrder(ADVENTURE_SERIES));
    const climbingWall = inputs.find((i) => i.input === COLOR_INPUT.CLIMBING_WALL);
    expect(climbingWall).toBeTruthy();
    expect(climbingWall.parts).toEqual(['climbing_wall']);
  });

  it('a gate explicitly "NOT Included" is excluded, everything else on the order still required', () => {
    const order = { productType: ADVENTURE_SERIES, colorGates: { ballPitMat: 'NOT Included' } };
    const inputs = requiredColorInputs(order);
    expect(inputs.find((i) => i.input === COLOR_INPUT.BALL_PIT)).toBeUndefined();
    expect(inputs.find((i) => i.input === COLOR_INPUT.ADVENTURE_MAT)).toBeTruthy();
  });

  it('gates are independent of frame type — Ball Pit can be required on a Soar order if its own gate is Included', () => {
    const order = { productType: SOAR, colorGates: { ballPitMat: 'Included' } };
    const inputs = requiredColorInputs(order);
    expect(inputs.find((i) => i.input === COLOR_INPUT.BALL_PIT)).toBeTruthy();
  });

  it('Soar requires the steel frame (Cardinal/Prismatic, soar_frame) plus its own vinyl Structure & Frame (column wraps + floor padding) as two separate inputs', () => {
    const order = { productType: SOAR, colorFrameType: 'Soar', colorGates: {
      adventureMat: 'NOT Included', climbingWallColor: 'NOT Included', climbingWallMat: 'NOT Included',
      wallPaddingMat: 'NOT Included', ballPitMat: 'NOT Included',
    } };
    const inputs = requiredColorInputs(order);
    expect(inputs).toHaveLength(2);
    expect(inputs.find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT).parts).toEqual(['soar_frame']);
    expect(inputs.find((i) => i.input === COLOR_INPUT.SOAR_MAT).parts).toEqual(['column_wraps', 'floor_padding']);
  });

  it('Flex requires the steel frame (Cardinal/Prismatic, flex_frame) plus its own vinyl Structure & Frame (floor pad) as two separate inputs', () => {
    for (const productType of [FLEX, FLEX_ACCESSORIES]) {
      const order = { productType, colorFrameType: 'Flex', colorGates: {
        adventureMat: 'NOT Included', climbingWallColor: 'NOT Included', climbingWallMat: 'NOT Included',
        wallPaddingMat: 'NOT Included', ballPitMat: 'NOT Included',
      } };
      const inputs = requiredColorInputs(order);
      expect(inputs).toHaveLength(2);
      expect(inputs.find((i) => i.input === COLOR_INPUT.STRUCTURE_FRAME_PAINT).parts).toEqual(['flex_frame']);
      expect(inputs.find((i) => i.input === COLOR_INPUT.FLEX_MAT).parts).toEqual(['floor_pad']);
    }
  });

  it('Palisades is buildable and independent of productType — not a "sub item" of Adventure (direct requirement, 2026-09-21)', () => {
    const order = { productType: SOAR, colorGates: { palisadesMat: 'Included' } };
    const inputs = requiredColorInputs(order);
    const palisades = inputs.find((i) => i.input === COLOR_INPUT.PALISADES_MAT);
    expect(palisades).toBeTruthy();
    expect(palisades.parts).toEqual([
      'palisades_mat_1', 'palisades_mat_2', 'palisades_mat_3', 'palisades_mat_4',
      'palisades_mat_5', 'palisades_mat_6', 'palisades_mat_7',
    ]);
  });

  it('every returned input is a recognized COLOR_INPUT type', () => {
    const inputs = requiredColorInputs(allIncludedOrder(ADVENTURE_SERIES));
    for (const i of inputs) {
      expect(Object.values(COLOR_INPUT)).toContain(i.input);
    }
  });
});

describe('unbuiltRequiredColorGates — real requirements with no picker built yet', () => {
  it('is empty when nothing not-yet-buildable is Included', () => {
    const order = { productType: ADVENTURE_SERIES, colorGates: {
      ballPitBalls: 'NOT Included', foundationMat: 'NOT Included',
    } };
    expect(unbuiltRequiredColorGates(order)).toEqual([]);
  });

  it('flags Ball Pit Balls/Foundation as Included but unbuilt — never silently dropped, never shown to the customer', () => {
    const order = { productType: ADVENTURE_SERIES, colorGates: {
      ballPitBalls: 'Included', foundationMat: 'Included',
    } };
    const gaps = unbuiltRequiredColorGates(order);
    expect(gaps.map((g) => g.gateKey)).toEqual(expect.arrayContaining(['ballPitBalls', 'foundationMat']));

    const inputs = requiredColorInputs(order);
    expect(inputs.find((i) => i.input === COLOR_INPUT.BALL_PIT_BALLS)).toBeUndefined();
    expect(inputs.find((i) => i.input === COLOR_INPUT.FOUNDATION_MAT)).toBeUndefined();
  });

  it('is always empty for a productType outside the gate-driven set', () => {
    expect(unbuiltRequiredColorGates(allIncludedOrder('Therapy Mats & Pads'))).toEqual([]);
    expect(unbuiltRequiredColorGates(allIncludedOrder('Something Not Real'))).toEqual([]);
  });
});

describe('allKnownInputParts', () => {
  it('unions parts across every productType/gate/frame type that shares the same input key', () => {
    const merged = allKnownInputParts();
    expect(merged[COLOR_INPUT.ADVENTURE_MAT]).toEqual(['zip_line']);
    expect(merged[COLOR_INPUT.CLIMBING_WALL]).toEqual(['climbing_wall']);
    expect(merged[COLOR_INPUT.STRUCTURE_FRAME_PAINT]).toEqual(
      expect.arrayContaining(['legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'soar_frame', 'flex_frame'])
    );
  });

  it('includes mat_pad_color parts for Therapy Mats & Pads', () => {
    const merged = allKnownInputParts();
    expect(merged[COLOR_INPUT.MAT_PAD_COLOR]).toEqual(['mat_pad']);
  });

  it('includes the new vinyl gate types (Soar/Flex/Wall Padding/Palisades)', () => {
    const merged = allKnownInputParts();
    expect(merged[COLOR_INPUT.SOAR_MAT]).toEqual(['column_wraps', 'floor_padding']);
    expect(merged[COLOR_INPUT.FLEX_MAT]).toEqual(['floor_pad']);
    expect(merged[COLOR_INPUT.WALL_PADDING]).toEqual(['column_wraps_pads']);
    expect(merged[COLOR_INPUT.PALISADES_MAT]).toHaveLength(7);
  });

  it('never fabricates an input/part combination not present in any real productType/gate', () => {
    const merged = allKnownInputParts();
    expect(merged.made_up_input).toBeUndefined();
    expect(merged[COLOR_INPUT.ADVENTURE_MAT]).not.toContain('made_up_part');
  });
});
