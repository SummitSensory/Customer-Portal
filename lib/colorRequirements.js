/**
 * Maps an order's real Monday.com productType to the color/finish inputs it
 * requires. This is the single source of truth the picker's checklist reads
 * from — see the Color Selection Experience doc, §02/§07.
 *
 * CRITICAL: keys here must be the exact, full Monday label — the same class
 * of bug already broke 4 of 5 real Jotform color-form routes in production
 * (see claude-project-docs/build-and-fix-2026-08-27.md #6): a short form
 * like "Summit Adventure Series" was used where Monday's real label is
 * "Summit Adventure Series: Custom Sensory Gym". Matching is exact-string,
 * case-sensitive, with NO normalization — same rule as everywhere else in
 * this codebase (lib/monday.js, pages/portal/index.js,
 * pages/api/jotform/webhook.js). Before adding or editing an entry, confirm
 * the label against a live order's `color_mkvw7b8` value, not a guess.
 *
 * STILL OPEN (see the Experience doc §G / Implementation Plan §10): which
 * *specific* structural parts a given order needs is confirmed to vary
 * order-to-order even within one product line (build-and-fix-2026-08-27.md
 * #3) — not fully determined by productType alone. Until Bryan decides how
 * that per-order subset is captured, STRUCTURAL_PARTS below lists the full
 * *eligible* set per product line as a conservative default: every eligible
 * part is treated as required rather than risk silently skipping a real
 * one. Narrowing this to the true per-order subset is a follow-up, not a
 * blocker for Phase 1.
 */

export const COLOR_INPUT = {
  STRUCTURE_FRAME_PAINT: 'structure_frame_paint',
  MAT_PAD_COLOR: 'mat_pad_color',
  BALL_PIT: 'ball_pit',
  BALL_PIT_BALLS: 'ball_pit_balls',
};

// Every structural part Cardinal/Prismatic paint could apply to, across all
// product lines. Confirmed by a full 160-item scan of the live GB board
// (build-and-fix-2026-08-27.md #3) — Adventure Series never touches Soar or
// Flex Frame, and vice versa; each product line's own subset is listed below.
const ALL_STRUCTURAL_PARTS = [
  'legs',
  'horizontal_beams',
  'ladder_rungs_and_leg',
  'slide_platform',
  'slide_color',
  'climbing_wall',
  'soar_frame',
  'flex_frame',
];

const REQUIREMENTS = {
  'Summit Adventure Series: Custom Sensory Gym': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'slide_platform', 'slide_color', 'climbing_wall'],
    },
  ],
  'Summit Soar: Mobile Free-Standing Swing Frame': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['soar_frame'],
    },
    // Column Wraps & Floor Padding is a distinct Jotform-only input today
    // (form 252664785765171) — not yet migrated to the native picker, so it
    // is intentionally absent from this manifest until Phase 3+.
  ],
  'Summit Flex: Universal Exercise Unit': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['flex_frame'],
    },
  ],
  'Summit Flex: Universal Exercise Unit & Accessories': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['flex_frame'],
    },
  ],
  // Real vinyl swatch photos were provided (2026-09-01) and pixel-sampled
  // into lib/data/vinylColors.json — matches every name already used on the
  // R board (8047969422). This moves Therapy Mats & Pads out of "no real
  // data" and into Phase 1 alongside Structure & Frame Paint.
  'Therapy Mats & Pads': [
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Mat & Pad Color',
      parts: ['mat_pad'],
    },
  ],

  // Ball Pit, Ball Pit Balls, Foundation, and Palisades are deliberately NOT
  // entered here yet — each still requires real, sourced color data (Ball
  // Pit colors) or a product decision (the single-color-vs-mix question for
  // Ball Pit Balls, see the Experience doc §G) that doesn't exist yet.
  // Adding a productType here without real backing data would let the
  // picker show unsourced options, which §03 explicitly forbids.
};

/**
 * Returns the list of required color inputs for a productType, or null if
 * the productType isn't recognized — callers MUST treat null as "fail
 * closed, do not silently skip," never as "no inputs required."
 */
export function requiredColorInputs(productType) {
  if (typeof productType !== 'string' || !productType) return null;
  const entry = REQUIREMENTS[productType];
  return entry ? entry : null;
}

export function isColorSelectionSupported(productType) {
  return requiredColorInputs(productType) !== null;
}

export function allStructuralParts() {
  return [...ALL_STRUCTURAL_PARTS];
}
