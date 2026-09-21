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
 * naming a real Monday.com status column per color-selection item, each an
 * INDEPENDENT "Included" / "NOT Included" gate — confirmed directly by him,
 * not derived from productType, not derived from each other, and not
 * derived from colorFrameType (a separate column that names which frame
 * type — Adventure/Soar/Flex — is part of the order, kept for display only;
 * it does NOT gate any requirement). Adventure Series, Soar, and Flex now
 * share ONE flat set of independently-gated inputs (GATED_INPUTS below)
 * instead of three separate static per-productType lists.
 *
 * Real, disclosed departure from the old static lists: under the old
 * model, an Adventure/Soar/Flex order's base structural frame
 * (legs/horizontal beams/ladder, soar_frame, flex_frame) was a
 * Cardinal/Prismatic PAINT input — eligible for the $500/$300 Prismatic
 * upcharge. Bryan's spreadsheet's Column D types every one of
 * Adventure-Mat/Soar-Mat/Flex-Mat Color as VINYL, and there is no separate
 * paint-type gate for any of those three frames anywhere in the sheet —
 * only Climbing Wall-Color (a Cardinal/Prismatic accessory, not part of the
 * base frame) still carries that upcharge path. Confirmed directly by
 * Bryan (2026-09-21), including Zip Line explicitly folding into
 * Adventure-Mat Color as vinyl. Flagged here because it's a real pricing
 * behavior change, not just a data-shape one.
 *
 * "Ball Pit-Ball Colors" / "Foundation System-Mat Color" have real gate
 * columns now but are NOT surfaced to customers yet — see `buildable:
 * false` below and `unbuiltRequiredColorGates()`. There's no
 * quantity-allocator UI for Ball Pit Balls, and no catalog data at all for
 * Foundation. A gate reading "Included" for one of these is a real,
 * unfulfilled requirement — surfaced to staff (admin panel), never
 * silently dropped and never shown to a customer as a picker that doesn't
 * exist. Slide-Color (plastic) WAS in this same unbuilt state until Bryan
 * supplied the real catalog 2026-09-21 (Blue/Green/Gray, Gray +$500 — see
 * SLIDE_COLORS in lib/colorCatalog.js) — now buildable and shown to
 * customers like every other gate.
 *
 * CRITICAL: productType matching is exact-string, case-sensitive, with NO
 * normalization — same rule as everywhere else in this codebase
 * (lib/monday.js, pages/portal/index.js, pages/api/jotform/webhook.js) —
 * this exact class of bug already broke 4 of 5 real Jotform color-form
 * routes in production once (build-and-fix-2026-08-27.md #6).
 */

export const COLOR_INPUT = {
  STRUCTURE_FRAME_PAINT: 'structure_frame_paint', // Cardinal/Prismatic paint — Climbing Wall only now, see header
  MAT_PAD_COLOR: 'mat_pad_color', // vinyl — Therapy Mats & Pads' own static entry only
  ADVENTURE_MAT: 'adventure_mat', // vinyl
  WALL_PADDING: 'wall_padding_mat', // vinyl
  CLIMBING_WALL_MAT: 'climbing_wall_mat', // vinyl
  SOAR_MAT: 'soar_mat', // vinyl
  FLEX_MAT: 'flex_mat', // vinyl
  PALISADES_MAT: 'palisades_mat', // vinyl
  BALL_PIT: 'ball_pit', // vinyl
  BALL_PIT_BALLS: 'ball_pit_balls', // vinyl — not yet buildable, see header
  FOUNDATION_MAT: 'foundation_mat', // vinyl — not yet buildable, see header
  SLIDE: 'slide', // plastic — real catalog sourced 2026-09-21, see header
};

/**
 * Which brand(s) a color is even allowed to come from, per input type.
 * FIXED (found in independent code review, 2026-09-01): without this, a Mat
 * & Pad Color selection using a real, valid PRISMATIC PAINT SKU passed
 * validation and could be confirmed, because nothing checked that vinyl is
 * the only brand that belongs on a mat/pad part at all. Deliberately no
 * entries for BALL_PIT_BALLS/FOUNDATION_MAT — see header; that means any
 * submission against those inputs is rejected outright (allowed = []),
 * which is correct since there's no real catalog to validate them against
 * yet. SLIDE has a real entry below (plastic) since Bryan supplied its
 * catalog 2026-09-21.
 */
export const ALLOWED_BRANDS = {
  [COLOR_INPUT.STRUCTURE_FRAME_PAINT]: ['cardinal', 'prismatic'],
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
};

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
    label: 'Structure & Frame',
    parts: ['legs', 'horizontal_beams', 'ladder_rungs_and_leg', 'zip_line'],
    buildable: true,
    legacyDefaultProductTypes: [ADVENTURE_SERIES],
  },
  {
    gateKey: 'climbingWallColor',
    input: COLOR_INPUT.STRUCTURE_FRAME_PAINT,
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
    gateKey: 'slideColor',
    input: COLOR_INPUT.SLIDE,
    label: 'Slide',
    parts: ['slide_platform', 'slide_color'],
    buildable: true, // real catalog sourced 2026-09-21 (Bryan: Blue/Green/Gray, Gray +$500)
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
    parts: [
      'ball_pit_vinyl', 'mat_section_1', 'mat_section_2', 'mat_section_3',
      'mat_section_4', 'mat_section_5', 'mat_section_6', 'mat_section_7',
    ],
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
    gateKey: 'foundationMat',
    input: COLOR_INPUT.FOUNDATION_MAT,
    label: 'Foundation System Mat',
    parts: [], // no catalog data sourced yet — see header
    buildable: false,
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
 * blanket fail-closed default was wrong here).
 */
export function requiredColorInputs(order) {
  const productType = order?.productType;
  if (typeof productType !== 'string' || !productType) return null;

  if (Object.prototype.hasOwnProperty.call(REQUIREMENTS, productType)) {
    return REQUIREMENTS[productType];
  }

  if (!GATE_DRIVEN_PRODUCT_TYPES.has(productType)) return null;

  const gates = order?.colorGates || {};
  return GATED_INPUTS
    .filter((g) => g.buildable)
    .filter((g) => gateIsRequired(g, order, gates))
    .map((g) => ({ input: g.input, label: g.label, parts: g.parts }));
}

/**
 * Real, gated requirements (per the same gateIsRequired() rule as
 * requiredColorInputs) that have NO native picker built yet — Ball Pit
 * Balls, Foundation. Surfaced to staff (admin panel) so a real requirement
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
};
