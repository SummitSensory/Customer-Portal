/**
 * Maps an order to the color/finish inputs it requires. This is the single
 * source of truth the picker's checklist reads from — see the Color
 * Selection Experience doc, §02/§07.
 *
 * REDESIGNED 2026-09-21: previously this was a static per-productType list
 * (every eligible part for a productType was unconditionally required — a
 * deliberately conservative "ask everything, never risk silently skipping a
 * real one" default, used because there was no real per-order signal for
 * which parts an order actually needed). Bryan supplied a real, verified
 * source for that signal: a "Color Selection Decision Tree" spreadsheet
 * naming a real Monday.com status column per color-selection item.
 *
 * Two genuinely different kinds of column, confirmed directly by Bryan
 * across several rounds of correction — do not collapse them:
 *
 * 1. **Product Type** (`colorFrameType`, column `color_mm7c461v`) — NOT an
 *    Included/NOT Included gate. Its value (Adventure / Soar / Flex / N/A)
 *    selects which Cardinal/Prismatic STEEL FRAME parts list applies —
 *    restoring the original, pre-redesign frame paint parts (legs/
 *    horizontal beams/ladder for Adventure, soar_frame, flex_frame) as an
 *    UNCONDITIONAL requirement whenever a real frame type applies (buying
 *    the frame means it needs a paint color) — "N/A" means no steel frame
 *    color at all. See STEEL_FRAME_PARTS_BY_TYPE/resolveFrameType below.
 * 2. **Every other column** (Climbing Wall-Color, Climbing Wall-Mat Color,
 *    Wall Padding-Mat Color, Slide-Color, Soar-Mat Color, Flex-Mat Color,
 *    Palisades-Mat Color, Ball Pit-Mat Color, Ball Pit-Ball Colors,
 *    Foundation System-Mat Color, and Adventure-Mat Color) IS a real,
 *    INDEPENDENT "Included"/"NOT Included" gate — confirmed not derived
 *    from productType, not derived from each other, and not derived from
 *    colorFrameType. Direct requirement (2026-09-21): "If someone
 *    purchases the Summit Soar, it does not mean they also purchased the
 *    mats that would go along with that product" — buying the frame (case
 *    1 above) is a separate question from whether each of these optional
 *    add-ons was also purchased. See GATED_INPUTS below.
 *
 * A column's NAME tells you its brand (direct rule from Bryan, 2026-09-21):
 * anything with "Mat Color" in the name is vinyl; "Slide-Color" is plastic
 * (see SLIDE_COLORS in lib/colorCatalog.js); Climbing Wall-Color and the
 * Product-Type-driven steel frame are Cardinal/Prismatic. Zip Line's color
 * is vinyl, explicitly folded into Adventure-Mat Color (direct requirement,
 * 2026-09-21) — NOT part of the Cardinal/Prismatic steel frame parts list.
 *
 * "Ball Pit-Ball Colors" has a real gate column but is NOT surfaced to
 * customers yet — see `buildable: false` below and
 * `unbuiltRequiredColorGates()`. There's no quantity-allocator UI for Ball
 * Pit Balls. A gate reading "Included" for it is a real,
 * unfulfilled requirement — surfaced to staff (admin panel), never
 * silently dropped and never shown to a customer as a picker that doesn't
 * exist. Slide-Color (plastic) WAS in this same unbuilt state until Bryan
 * supplied the real catalog 2026-09-21 (Blue/Green/Gray, Gray +$500) — now
 * buildable and shown to customers like every other gate. Foundation
 * System-Mat Color followed the same path 2026-09-22 (Black/Gray, Red/Blue,
 * Green/Gray — its own two-tone foam-tile catalog, FOUNDATION_MAT_COLORS in
 * lib/colorCatalog.js, not vinyl despite "Mat Color" in the column name).
 *
 * CRITICAL: productType matching is exact-string, case-sensitive, with NO
 * normalization — same rule as everywhere else in this codebase
 * (lib/monday.js, pages/portal/index.js, pages/api/jotform/webhook.js) —
 * this exact class of bug already broke 4 of 5 real Jotform color-form
 * routes in production once (build-and-fix-2026-08-27.md #6).
 */

export const COLOR_INPUT = {
  STRUCTURE_FRAME_PAINT: 'structure_frame_paint', // Cardinal/Prismatic paint — the steel frame itself, driven by Product Type (colorFrameType)
  CLIMBING_WALL: 'climbing_wall_color', // Cardinal/Prismatic paint — its own independent gate, separate from the steel frame
  MAT_PAD_COLOR: 'mat_pad_color', // vinyl — Therapy Mats & Pads' own static entry only
  ADVENTURE_MAT: 'adventure_mat', // vinyl — ONE color for every Adventure mat (floor padding, column wraps, zip line), per Bryan 2026-09-23
  WALL_PADDING: 'wall_padding_mat', // vinyl
  CLIMBING_WALL_MAT: 'climbing_wall_mat', // vinyl
  SOAR_MAT: 'soar_mat', // vinyl
  FLEX_MAT: 'flex_mat', // vinyl
  PALISADES_MAT: 'palisades_mat', // vinyl
  BALL_PIT: 'ball_pit', // vinyl
  BALL_PIT_BALLS: 'ball_pit_balls', // vinyl — not yet buildable, see header
  FOUNDATION_MAT: 'foundation_mat', // two-tone foam tile — real catalog sourced 2026-09-22, see header
  SLIDE: 'slide', // plastic — the slide itself (Blue/Green)
  SLIDE_PLATFORM: 'slide_platform_paint', // Cardinal/Prismatic paint — the steel slide platform (GB board paints it), per Bryan 2026-09-23
  CLIMB_SLIDE: 'climb_slide_mat', // vinyl — 90 Degree Climb & Slide, 3 mat pieces (added by Bryan 2026-09-23)
};

/**
 * Which brand(s) a color is even allowed to come from, per input type.
 * FIXED (found in independent code review, 2026-09-01): without this, a Mat
 * & Pad Color selection using a real, valid PRISMATIC PAINT SKU passed
 * validation and could be confirmed, because nothing checked that vinyl is
 * the only brand that belongs on a mat/pad part at all. Deliberately no
 * entry for BALL_PIT_BALLS — see header; that means any
 * submission against those inputs is rejected outright (allowed = []),
 * which is correct since there's no real catalog to validate them against
 * yet. SLIDE has a real entry below (plastic) since Bryan supplied its
 * catalog 2026-09-21.
 */
export const ALLOWED_BRANDS = {
  [COLOR_INPUT.STRUCTURE_FRAME_PAINT]: ['cardinal', 'prismatic'],
  [COLOR_INPUT.CLIMBING_WALL]: ['cardinal', 'prismatic'],
  [COLOR_INPUT.MAT_PAD_COLOR]: ['vinyl'],
  [COLOR_INPUT.ADVENTURE_MAT]: ['vinyl'],
  [COLOR_INPUT.WALL_PADDING]: ['vinyl'],
  [COLOR_INPUT.CLIMBING_WALL_MAT]: ['vinyl'],
  [COLOR_INPUT.SOAR_MAT]: ['vinyl'],
  [COLOR_INPUT.FLEX_MAT]: ['vinyl'],
  [COLOR_INPUT.PALISADES_MAT]: ['vinyl'],
  [COLOR_INPUT.BALL_PIT]: ['vinyl'],
  // Real catalog sourced 2026-09-21 (Bryan: Blue, Green, Gray, Gray +$500)
  // — see SLIDE_COLORS in lib/colorCatalog.js.
  [COLOR_INPUT.SLIDE]: ['plastic'],
  // The slide PLATFORM is painted steel, not plastic — the GB board has its
  // own Paint Brand/Color/Code columns for it and counts it in the Prismatic
  // formula (Bryan 2026-09-23). Only the slide itself is plastic.
  [COLOR_INPUT.SLIDE_PLATFORM]: ['cardinal', 'prismatic'],
  [COLOR_INPUT.CLIMB_SLIDE]: ['vinyl'],
  // Real catalog sourced 2026-09-22 (Bryan: Black/Gray, Red/Blue,
  // Green/Gray) — see FOUNDATION_MAT_COLORS in lib/colorCatalog.js.
  [COLOR_INPUT.FOUNDATION_MAT]: ['foundation'],
};

// The real, original (pre-redesign) Cardinal/Prismatic steel frame parts
// per frame type — restored 2026-09-21 per Bryan's direct instruction that
// "the previously built color selection choices that were built for the
// frame color selections are still being used." Slide/Climbing
// Wall/Zip Line are deliberately NOT here — each is its own independently
// gated item (Slide-Color/plastic, Climbing Wall-Color/paint,
// Adventure-Mat Color/vinyl respectively), carved out of what used to be
// one bundled Adventure Series entry.
const STEEL_FRAME_PARTS_BY_TYPE = {
  Adventure: ['legs', 'horizontal_beams', 'ladder_rungs_and_leg'],
  Soar: ['soar_frame'],
  Flex: ['flex_frame'],
};

/**
 * Resolves which steel frame parts list applies, or null for "no steel
 * frame color" (either colorFrameType is explicitly "N/A", or the order's
 * productType isn't one of the 3 frame types at all). An explicit,
 * recognized colorFrameType always wins; when it's blank/unrecognized (an
 * order predating this column), falls back to inferring from the order's
 * real productType — same fail-closed reasoning as gateIsRequired below:
 * this requirement was unconditional for every one of these productTypes
 * under the old model, so a missing column must not silently drop it.
 */
function resolveFrameType(order) {
  const raw = order?.colorFrameType;
  if (raw === 'N/A') return null;
  if (Object.prototype.hasOwnProperty.call(STEEL_FRAME_PARTS_BY_TYPE, raw)) return raw;
  const productType = order?.productType;
  if (productType === ADVENTURE_SERIES) return 'Adventure';
  if (productType === SOAR) return 'Soar';
  if (productType === FLEX || productType === FLEX_ACCESSORIES) return 'Flex';
  return null;
}

const REQUIRED_GATE_VALUE = 'Included';
const NOT_REQUIRED_GATE_VALUE = 'NOT Included';

// The real, full Monday productType labels — exact-string, case-sensitive,
// see this file's header.
const ADVENTURE_SERIES = 'Summit Adventure Series: Custom Sensory Gym';
const SOAR = 'Summit Soar: Mobile Free-Standing Swing Frame';
const FLEX = 'Summit Flex: Universal Exercise Unit';
const FLEX_ACCESSORIES = 'Summit Flex: Universal Exercise Unit & Accessories';

// The productTypes Bryan's decision tree covers — Adventure Series, Soar,
// and Flex (both Flex labels) share ONE flat, gate-driven set of inputs
// (GATED_INPUTS below), fully independent of which of these three the
// order actually is. Therapy Mats & Pads is NOT covered by the sheet and
// keeps its own separate static entry (REQUIREMENTS below), untouched.
const GATE_DRIVEN_PRODUCT_TYPES = new Set([ADVENTURE_SERIES, SOAR, FLEX, FLEX_ACCESSORIES]);

/**
 * One entry per real Monday gate column on Bryan's decision tree.
 * `gateKey` matches the key under order.colorGates (see lib/monday.js's
 * parseOrderItem). `buildable: false` means the gate is real and tracked,
 * but no native picker UI exists for it yet — see this file's header.
 *
 * `legacyDefaultProductTypes`: which productType(s), if any, this exact
 * item was ALREADY unconditionally required for under the old static
 * per-productType model (before this 2026-09-21 redesign) — used ONLY to
 * decide the fail-closed default when a gate is entirely unset (an order
 * predating these Monday columns). Real, deliberate design decision: full
 * independence between gates (confirmed by Bryan) plus a blanket
 * fail-closed-when-unset default would mean an Adventure Series order with
 * no colorGates data yet also unconditionally required Soar-Mat AND
 * Flex-Mat colors, since nothing says otherwise — an obviously wrong
 * result, caught by this file's own tests, not shipped silently. Scoping
 * the fail-closed default to each item's historical productType preserves
 * exactly today's live behavior until Monday's columns are populated, and
 * items with no prior requirement at all (Palisades, Ball Pit Balls,
 * Foundation, and any cross-frame-type combination like Ball Pit on a Soar
 * order) default to NOT required — they only turn on via an explicit
 * "Included", never by omission, since there's no existing behavior to
 * preserve and defaulting them off is the safer, less surprising choice.
 */
const GATED_INPUTS = [
  {
    gateKey: 'adventureMat',
    input: COLOR_INPUT.ADVENTURE_MAT,
    // One color for every Adventure mat — floor padding, column wraps and
    // the zip line (Bryan, 2026-09-23). Was a Zip Line-only pick.
    label: 'Adventure Mat System',
    parts: ['adventure_mat_system'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'climbingWallColor',
    input: COLOR_INPUT.CLIMBING_WALL,
    label: 'Climbing Wall',
    parts: ['climbing_wall'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'climbingWallMat',
    input: COLOR_INPUT.CLIMBING_WALL_MAT,
    label: 'Climbing Wall Mat',
    parts: ['climbing_wall_mat'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'wallPaddingMat',
    input: COLOR_INPUT.WALL_PADDING,
    label: 'Wall Padding',
    parts: ['column_wraps_pads'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    // Same Slide-Color gate as the plastic slide below: buying the slide
    // means both the painted platform and the plastic slide need a color.
    gateKey: 'slideColor',
    input: COLOR_INPUT.SLIDE_PLATFORM,
    label: 'Slide Platform',
    parts: ['slide_platform'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'slideColor',
    input: COLOR_INPUT.SLIDE,
    label: 'Slide',
    parts: ['slide_color'],
    buildable: true, // Blue/Green (Gray removed 2026-09-23)
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'soarMat',
    input: COLOR_INPUT.SOAR_MAT,
    label: 'Structure & Frame',
    parts: ['column_wraps', 'floor_padding'],
    buildable: true,
    legacyDefaultProductTypes: [SOAR],
  },
  {
    gateKey: 'flexMat',
    input: COLOR_INPUT.FLEX_MAT,
    label: 'Structure & Frame',
    parts: ['floor_pad'],
    buildable: true,
    legacyDefaultProductTypes: [FLEX, FLEX_ACCESSORIES],
  },
  {
    gateKey: 'palisadesMat',
    input: COLOR_INPUT.PALISADES_MAT,
    label: 'Palisades Mat Pieces',
    parts: [
      'palisades_mat_1', 'palisades_mat_2', 'palisades_mat_3', 'palisades_mat_4',
      'palisades_mat_5', 'palisades_mat_6', 'palisades_mat_7',
    ],
    buildable: true,
    legacyDefaultProductTypes: [], // never required under the old model — default NOT required until explicitly Included
  },
  {
    gateKey: 'ballPitMat',
    input: COLOR_INPUT.BALL_PIT,
    label: 'Ball Pit',
    // One color for the whole ball pit (Bryan, 2026-09-23). Was 8 picks.
    parts: ['ball_pit_vinyl'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'ballPitBalls',
    input: COLOR_INPUT.BALL_PIT_BALLS,
    label: 'Ball Pit Ball Colors',
    parts: [], // no quantity-allocator UI yet — see header
    buildable: false,
    legacyDefaultProductTypes: [],
  },
  {
    // Deal Tracking "90 Deg Climb/Slide-Mat Color" (color_mm7g1481), added by
    // Bryan 2026-09-23. Three mat pieces, numbered on the product image shown
    // in the picker: 1 = top platform, 2 = slide, 3 = stairs.
    gateKey: 'climbSlideMat',
    input: COLOR_INPUT.CLIMB_SLIDE,
    label: '90 Degree Climb & Slide',
    parts: ['climb_slide_piece_1', 'climb_slide_piece_2', 'climb_slide_piece_3'],
    image: '/color-catalog/climb-slide/90-degree-climb-slide.png',
    buildable: true,
    legacyDefaultProductTypes: [], // new product — only when explicitly Included
  },
  {
    gateKey: 'foundationMat',
    input: COLOR_INPUT.FOUNDATION_MAT,
    label: 'Foundation System Mat',
    parts: ['foundation_mat'],
    buildable: true, // real catalog sourced 2026-09-22 (Bryan: Black/Gray, Red/Blue, Green/Gray)
    legacyDefaultProductTypes: [],
  },
];

/**
 * Whether a gate is required for this order: an explicit "Included"/"NOT
 * Included" always wins; otherwise falls back to
 * gate.legacyDefaultProductTypes — see that field's own comment above for
 * why this isn't a blanket fail-closed default.
 */
function gateIsRequired(gate, order, gates) {
  const value = gates[gate.gateKey];
  if (value === REQUIRED_GATE_VALUE) return true;
  if (value === NOT_REQUIRED_GATE_VALUE) return false;
  return gate.legacyDefaultProductTypes.includes(order?.productType);
}

// Therapy Mats & Pads is NOT covered by Bryan's decision tree — kept as its
// own static, unconditional entry exactly as before.
const REQUIREMENTS = {
  'Therapy Mats & Pads': [
    {
      input: COLOR_INPUT.MAT_PAD_COLOR,
      label: 'Mat & Pad Color',
      parts: ['mat_pad'],
    },
  ],
};

/**
 * Returns the list of required color inputs for an order, or null if the
 * order's productType isn't recognized — callers MUST treat null as "fail
 * closed, do not silently skip," never as "no inputs required."
 *
 * Takes the FULL order object (not just productType) — for the
 * gate-driven productTypes, this reads order.colorGates, populated by
 * lib/monday.js's parseOrderItem. Per-gate requiredness is decided by
 * gateIsRequired() above — an explicit "Included"/"NOT Included" always
 * wins; an unset gate falls back to whether this exact item was already
 * unconditionally required for this productType under the old static
 * model (see GATED_INPUTS' legacyDefaultProductTypes comment for why a
 * blanket fail-closed default was wrong here). The Cardinal/Prismatic
 * steel frame (see resolveFrameType above) is prepended separately — it's
 * NOT one of the Included/NOT Included gates, it's driven by Product Type
 * (colorFrameType) and unconditional whenever a real frame type applies.
 */
export function requiredColorInputs(order) {
  const productType = order?.productType;
  if (typeof productType !== 'string' || !productType) return null;

  if (Object.prototype.hasOwnProperty.call(REQUIREMENTS, productType)) {
    return REQUIREMENTS[productType];
  }

  if (!GATE_DRIVEN_PRODUCT_TYPES.has(productType)) return null;

  const frameType = resolveFrameType(order);
  const steelFrame = frameType
    ? [{ input: COLOR_INPUT.STRUCTURE_FRAME_PAINT, label: 'Structure & Frame Paint', parts: STEEL_FRAME_PARTS_BY_TYPE[frameType] }]
    : [];

  const gates = order?.colorGates || {};
  const gated = GATED_INPUTS
    .filter((g) => g.buildable)
    .filter((g) => gateIsRequired(g, order, gates))
    .map((g) => ({ input: g.input, label: g.label, parts: g.parts, ...(g.image ? { image: g.image } : {}) }));

  return [...steelFrame, ...gated];
}

/**
 * Real, gated requirements (per the same gateIsRequired() rule as
 * requiredColorInputs) that have NO native picker built yet — Ball Pit
 * Balls. Surfaced to staff (admin panel) so a real requirement
 * never silently goes unnoticed just because there's nowhere for a
 * customer to fulfill it yet.
 */
export function unbuiltRequiredColorGates(order) {
  const productType = order?.productType;
  if (!GATE_DRIVEN_PRODUCT_TYPES.has(productType)) return [];
  const gates = order?.colorGates || {};
  return GATED_INPUTS
    .filter((g) => !g.buildable)
    .filter((g) => gateIsRequired(g, order, gates))
    .map((g) => ({ label: g.label, gateKey: g.gateKey }));
}

export function isColorSelectionSupported(productType) {
  return productType === 'Therapy Mats & Pads' || GATE_DRIVEN_PRODUCT_TYPES.has(productType);
}

/**
 * The union of every {input: [parts]} combination valid under ANY known
 * productType/gate — not scoped to one order. Used by sanitizeSelections
 * (lib/colorSelectionValidation.js) as a bounded, fully-known whitelist
 * key-space, deliberately broader than requiredColorInputs(order) alone.
 * Direct requirement (2026-09-03): if an order's productType is edited on
 * Monday WHILE a customer is still actively (unconfirmed) editing —
 * including a staff typo caught and reverted moments later — sanitizing
 * against only the CURRENT productType would silently and permanently
 * erase the customer's real, already-saved selections for parts that don't
 * exist under the new value, even if the edit gets reverted right back.
 * Using the full known union instead means a transient/reverted mismatch
 * never destroys real data, while the whitelist stays exactly as strict
 * against genuinely arbitrary/malformed input — every key here still comes
 * from a real, enumerated productType/gate above, never from a client.
 */
// Parts retired by the 2026-09-23 layout change (Zip Line → Adventure Mat
// System, plastic slide platform → painted platform, 8 Ball Pit picks → 1).
// Kept in the whitelist so a customer's already-saved picks survive their
// next autosave instead of being silently deleted — they are no longer
// REQUIRED (requiredColorInputs never lists them) and show as earlier picks
// in the confirmed/admin views.
const RETIRED_PARTS = {
  [COLOR_INPUT.ADVENTURE_MAT]: ['zip_line'],
  [COLOR_INPUT.SLIDE]: ['slide_platform'],
  [COLOR_INPUT.BALL_PIT]: ['mat_section_1', 'mat_section_2', 'mat_section_3', 'mat_section_4', 'mat_section_5', 'mat_section_6', 'mat_section_7'],
};

export function allKnownInputParts() {
  const merged = {};
  const add = (input, parts) => {
    if (!merged[input]) merged[input] = new Set();
    parts.forEach((p) => merged[input].add(p));
  };
  for (const inputs of Object.values(REQUIREMENTS)) {
    for (const entry of inputs) add(entry.input, entry.parts);
  }
  for (const gate of GATED_INPUTS) add(gate.input, gate.parts);
  for (const parts of Object.values(STEEL_FRAME_PARTS_BY_TYPE)) add(COLOR_INPUT.STRUCTURE_FRAME_PAINT, parts);
  for (const [input, parts] of Object.entries(RETIRED_PARTS)) add(input, parts);
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
  climbing_wall_mat: 'Climbing Wall Mat',
  zip_line: 'Zip Line',
  adventure_mat_system: 'Adventure Mat System (floor padding, column wraps & zip line)',
  climb_slide_piece_1: 'Mat Piece 1 — Top Platform',
  climb_slide_piece_2: 'Mat Piece 2 — Slide',
  climb_slide_piece_3: 'Mat Piece 3 — Stairs',
  soar_frame: 'Soar Frame',
  flex_frame: 'Flex Frame',
  mat_pad: 'Mat & Pad',
  column_wraps: 'Column Wraps',
  floor_padding: 'Floor Padding',
  column_wraps_pads: 'Wall Padding',
  floor_pad: 'Floor Pad',
  ball_pit_vinyl: 'Ball Pit Vinyl',
  mat_section_1: 'Mat Section 1',
  mat_section_2: 'Mat Section 2',
  mat_section_3: 'Mat Section 3',
  mat_section_4: 'Mat Section 4',
  mat_section_5: 'Mat Section 5',
  mat_section_6: 'Mat Section 6',
  mat_section_7: 'Mat Section 7',
  palisades_mat_1: 'Mat Piece 1',
  palisades_mat_2: 'Mat Piece 2',
  palisades_mat_3: 'Mat Piece 3',
  palisades_mat_4: 'Mat Piece 4',
  palisades_mat_5: 'Mat Piece 5',
  palisades_mat_6: 'Mat Piece 6',
  palisades_mat_7: 'Mat Piece 7',
  foundation_mat: 'Foundation System Mat',
};
