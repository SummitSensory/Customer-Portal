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

/**
 * Which brand(s) a color is even allowed to come from, per input type.
 * FIXED (found in independent code review, 2026-09-01): without this,
 * pages/api/portal/color-selection.js's validation only checked "is this
 * code real within whichever brand the client claims" — a Mat & Pad Color
 * selection using a real, valid PRISMATIC PAINT SKU passed validation and
 * could be confirmed, because nothing checked that vinyl is the only brand
 * that belongs on a mat/pad part at all.
 */
export const ALLOWED_BRANDS = {
  [COLOR_INPUT.STRUCTURE_FRAME_PAINT]: ['cardinal', 'prismatic'],
  [COLOR_INPUT.MAT_PAD_COLOR]: ['vinyl'],
  // Ball Pit's own mat/vinyl parts (see the Adventure Series entry below) —
  // same vinyl-only restriction as MAT_PAD_COLOR, kept as its own COLOR_INPUT
  // bucket (not folded into MAT_PAD_COLOR) so the checklist shows "Ball Pit"
  // as its own row rather than merging it into "Column Wraps & Pads," which
  // is a separate real Jotform question with its own Yes/No gate.
  [COLOR_INPUT.BALL_PIT]: ['vinyl'],
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
  'zip_line',
  'soar_frame',
  'flex_frame',
];

const REQUIREMENTS = {
  // PORTAL-055: the real Jotform color form for this productType (243436740186156,
  // verified live via the Jotform API 2026-09-09) asks for far more than the
  // 6 frame-paint parts this used to list — it also gates (via "Did Your
  // Order Include X?" Yes/No, same pattern already used for Ladders/Slide/
  // Climbing Wall above, which are already treated as unconditionally
  // required per this file's own documented conservative-default policy) a
  // Zip Line paint color, a combined "Column Wraps and Pads" vinyl color, and
  // — if the order includes a Ball Pit — 7 vinyl mat sections plus its own
  // vinyl color. Since the color tab is an all-or-nothing native/Jotform
  // switch (colorSelectionWritable is a global flag, not per-order — see
  // lib/monday.js), every one of these was silently unreachable for every
  // Adventure Series order the moment the native picker went live — the
  // exact bug class just fixed for Soar's Column Wraps & Floor Padding
  // (2026-09-08), just far larger in scope here. Zip Line reuses the same
  // Cardinal/Prismatic catalogs as every other structural part; Column Wraps
  // & Pads and Ball Pit reuse the same real, sourced vinyl catalog already
  // proven for Therapy Mats & Pads / Soar (identical 14 color names).
  //
  // Deliberately NOT added here (real gaps, still open — see
  // colorRequirements.test.js's own "does not yet claim support" case):
  //   - Ball Pit Balls (per-color BALL QUANTITY, 13 colors × 0-2000 each) —
  //     this isn't a "pick one color" selection at all; it needs its own
  //     input paradigm (a quantity allocator, not the {brand,code} shape
  //     every part here uses) plus new validation/pricing rules. Building
  //     that is a real, separate piece of work, not a data-alignment fix.
  //   - Palisades Mat System — no real, sourced color data exists for it at
  //     any point (confirmed in the design docs); adding it here without
  //     real backing data would show unsourced options, which this file's
  //     own header explicitly forbids.
  'Summit Adventure Series: Custom Sensory Gym': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'slide_platform', 'slide_color', 'climbing_wall', 'zip_line'],
    },
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Column Wraps & Pads',
      parts: ['column_wraps_pads'],
    },
    {
      input: COLOR_INPUT.BALL_PIT,
      label: 'Ball Pit',
      parts: ['ball_pit_vinyl', 'mat_section_1', 'mat_section_2', 'mat_section_3', 'mat_section_4', 'mat_section_5', 'mat_section_6', 'mat_section_7'],
    },
  ],
  'Summit Soar: Mobile Free-Standing Swing Frame': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['soar_frame'],
    },
    // Migrated to the native picker 2026-09-08. Previously this was a
    // distinct Jotform-only input (form 252664785765171) — but since the
    // "color" tab is an all-or-nothing switch per order (native picker OR
    // the Jotform iframe, never both — pages/portal/index.js), Soar
    // qualifying for the native picker via Structure & Frame Paint above
    // meant that Jotform iframe became unreachable the moment the native
    // picker went live (2026-09-03). Column Wraps & Floor Padding was
    // silently dropped from the customer journey, not deferred, for every
    // Soar order in that window. Reuses the same vinyl catalog and
    // MAT_PAD_COLOR/vinyl-only brand restriction already proven for
    // Therapy Mats & Pads below — no new catalog data needed.
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Column Wraps & Floor Padding',
      parts: ['column_wraps', 'floor_padding'],
    },
  ],
  // PORTAL-055: the real Flex Jotform color form (243426572564158, verified
  // live 2026-09-09) also gates a Floor Pad vinyl color behind "Did Your
  // Order Include a Floor Pad?" — same orphaning issue as Adventure Series
  // above, just a single part here. Reuses the same real vinyl catalog.
  'Summit Flex: Universal Exercise Unit': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['flex_frame'],
    },
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Floor Pad',
      parts: ['floor_pad'],
    },
  ],
  'Summit Flex: Universal Exercise Unit & Accessories': [
    {
      input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
      label: 'Structure & Frame Paint',
      parts: ['flex_frame'],
    },
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Floor Pad',
      parts: ['floor_pad'],
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

/**
 * The union of every {input: [parts]} combination valid under ANY known
 * productType — not scoped to one order. Used by sanitizeSelections
 * (lib/colorSelectionValidation.js) as a bounded, fully-known whitelist
 * key-space, deliberately broader than requiredColorInputs(order.productType)
 * alone. Direct requirement (2026-09-03): if an order's productType is
 * edited on Monday WHILE a customer is still actively (unconfirmed) editing
 * — including a staff typo caught and reverted moments later — sanitizing
 * against only the CURRENT productType would silently and permanently erase
 * the customer's real, already-saved selections for parts that don't exist
 * under the new value, even if the edit gets reverted right back. Using the
 * full known union instead means a transient/reverted mismatch never
 * destroys real data, while the whitelist stays exactly as strict against
 * genuinely arbitrary/malformed input — every key here still comes from a
 * real, enumerated productType in REQUIREMENTS above, never from a client.
 * A PERMANENT productType change (the order genuinely becomes a different
 * product) is unaffected by this: validateColorSelectionData/
 * requiredColorInputs still only ever require/display the CURRENT
 * productType's own parts, so a customer's checklist always reflects what's
 * actually being manufactured — this only changes whether stale-schema data
 * gets silently deleted from storage, never what's shown as required.
 */
export function allKnownInputParts() {
  const merged = {};
  for (const inputs of Object.values(REQUIREMENTS)) {
    for (const entry of inputs) {
      if (!merged[entry.input]) merged[entry.input] = new Set();
      entry.parts.forEach((p) => merged[entry.input].add(p));
    }
  }
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, [...v]]));
}

/**
 * Shared display labels for part keys — used by both the customer picker
 * (components/portal/ColorSelectionTab.js) and the admin detail panel
 * (pages/admin/index.js) so the two can't drift apart, the same reasoning
 * behind lib/messageOrigin.js existing as its own shared module.
 */
export const PART_LABELS = {
  legs: 'Legs',
  horizontal_beams: 'Horizontal Beams',
  ladder_rungs_and_leg: 'Ladder Rungs & Ladder Leg',
  slide_platform: 'Slide Platform',
  slide_color: 'Slide',
  climbing_wall: 'Climbing Wall',
  zip_line: 'Zip Line',
  soar_frame: 'Soar Frame',
  flex_frame: 'Flex Frame',
  mat_pad: 'Mat & Pad',
  column_wraps: 'Column Wraps',
  floor_padding: 'Floor Padding',
  column_wraps_pads: 'Column Wraps & Pads',
  floor_pad: 'Floor Pad',
  ball_pit_vinyl: 'Ball Pit Vinyl',
  mat_section_1: 'Mat Section 1',
  mat_section_2: 'Mat Section 2',
  mat_section_3: 'Mat Section 3',
  mat_section_4: 'Mat Section 4',
  mat_section_5: 'Mat Section 5',
  mat_section_6: 'Mat Section 6',
  mat_section_7: 'Mat Section 7',
};
