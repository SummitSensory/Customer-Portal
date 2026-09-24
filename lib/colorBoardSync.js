/**
 * Confirmed color selections → the staff color boards.
 *
 * When a customer confirms their colors, the native picker's answers are written
 * automatically onto the three staff boards so nobody re-types them (Bryan,
 * 2026-09-23: "I don't want my staff manually adding anything"):
 *
 *   - ALL PRODUCTS - Color Selection (GB)          8097394746  frame / climbing wall / slide paint, slide color
 *   - ALL PRODUCTS - Color Selection (R)           8047969422  mats and padding
 *   - ALL PRODUCTS - Color Selection (Accessories) 18432226626 ball pit, foundation, Palisades, 90° climb & slide
 *
 * The portal's JSON column on Manufacturing Process stays the machine-readable
 * source (ssg-cpq-app reads it to color the Bill of Materials); these boards are
 * the human-readable copy, and GB's is what its Prismatic Upcharge formula (and
 * through it, invoicing) reads.
 *
 * Finding the right row. Names do NOT match across boards ("Diverse Options Inc."
 * on GB vs "Diverse Options (Adventure Series)" on Manufacturing), and links are
 * one-directional and inconsistent, so rows are found ONLY by an explicit link:
 *   1. the Manufacturing item's own relation column to that board, else
 *   2. a row on that board whose back-link to Manufacturing names this order, else
 *   3. a new row is created.
 * Never by name — writing one customer's colors onto another's row is far worse
 * than an extra row. Both link directions are then set, so the Manufacturing
 * mirrors (e.g. "Prismatic Color Up Charge") see the row.
 *
 * Each row is written in ONE mutation (all its columns together), and only the
 * columns for parts on the order's current checklist are touched — anything
 * else already on a staff row is left alone.
 */

import { mondayQuery } from './monday';
import { COLOR_INPUT } from './colorRequirements';
import { resolveSelectedColor, displayColorName } from './colorCatalog';

const env = (k, d) => process.env[k] || d;

export const BOARDS = {
  gb: {
    id: env('MONDAY_GB_COLOR_BOARD_ID', '8097394746'),
    label: 'GB',
    mfgLink: 'connect_boards64__1', // Manufacturing Process → GB
    backLink: 'connect_boards_1_Mjj6Q3vX', // GB "Manufacturing"
  },
  r: {
    id: env('MONDAY_R_COLOR_BOARD_ID', '8047969422'),
    label: 'R',
    mfgLink: 'connect_boards25__1', // Manufacturing Process → R
    backLink: 'board_relation__1', // R "link to Manufacturing Process"
  },
  acc: {
    id: env('MONDAY_ACC_COLOR_BOARD_ID', '18432226626'),
    label: 'Accessories',
    mfgLink: 'board_relation_mm7e17f', // Manufacturing Process → Accessories
    backLink: 'board_relation_mm7evvee', // Accessories "link to Manufacturing Process"
  },
};

const RECEIVED = 'Received';

// GB: one Brand status + Color text + Code text per painted part.
const GB_PAINT = {
  [`${COLOR_INPUT.STRUCTURE_FRAME_PAINT}.legs`]: { brand: 'status__1', color: 'text__1', code: 'text_Mjj6nXbz' },
  [`${COLOR_INPUT.STRUCTURE_FRAME_PAINT}.horizontal_beams`]: { brand: 'color_mkkdmta3', color: 'text_mkkdn40c', code: 'text_mkkdxnmq' },
  [`${COLOR_INPUT.STRUCTURE_FRAME_PAINT}.ladder_rungs_and_leg`]: { brand: 'color_mkkdcxhz', color: 'text_mkkd5bnr', code: 'text_mkkds07k' },
  [`${COLOR_INPUT.SLIDE_PLATFORM}.slide_platform`]: { brand: 'color_mkkdkegr', color: 'text_mkkdg843', code: 'text_1_mkkddjzg' },
  [`${COLOR_INPUT.CLIMBING_WALL}.climbing_wall`]: { brand: 'color_mkkdvk8w', color: 'text_mkkdps69', code: 'text_mkkdxjxv' },
  [`${COLOR_INPUT.STRUCTURE_FRAME_PAINT}.soar_frame`]: { brand: 'color_mkmfthfx', color: 'text_mkmfn2z7', code: 'text_mkmfwszc', prismaticLabel: 'Prismatic (+$350.00)' },
  [`${COLOR_INPUT.STRUCTURE_FRAME_PAINT}.flex_frame`]: { brand: 'color_mkmfnzad', color: 'text_mkmf2cfm', code: 'text_mkmfha22', prismaticLabel: 'Prismatic (+$350.00)' },
};
const GB_SLIDE_COLOR = 'status_mkkdc95c'; // labels: Green / Blue / N/A / -
const GB_REQUEST = 'project_status';

// R: one text column per mat area, plus the board's existing single status.
const R_TEXT = {
  [`${COLOR_INPUT.ADVENTURE_MAT}.adventure_mat_system`]: 'text_mm7g7g9q',
  [`${COLOR_INPUT.CLIMBING_WALL_MAT}.climbing_wall_mat`]: 'text_mm7gas1b',
  [`${COLOR_INPUT.WALL_PADDING}.column_wraps_pads`]: 'text_mm7gg5n4',
  // "Soar Column Wraps Color" — column not created yet (a permission prompt
  // blocked it 2026-09-23). Until it exists this pick lands only in the
  // main "Mat/Padding Color Choices" status below.
  [`${COLOR_INPUT.SOAR_MAT}.column_wraps`]: env('MONDAY_R_COL_SOAR_COLUMN_WRAPS', ''),
  [`${COLOR_INPUT.SOAR_MAT}.floor_padding`]: 'text_mm7g3sm1',
  [`${COLOR_INPUT.FLEX_MAT}.floor_pad`]: 'text_mm7g98bf',
};
const R_MAIN_COLOR = 'status9__1'; // "Mat/Padding Color Choices"
// Which pick fills the single main status, in order of preference.
const R_MAIN_PRIORITY = [
  `${COLOR_INPUT.MAT_PAD_COLOR}.mat_pad`,
  `${COLOR_INPUT.ADVENTURE_MAT}.adventure_mat_system`,
  `${COLOR_INPUT.SOAR_MAT}.column_wraps`,
  `${COLOR_INPUT.FLEX_MAT}.floor_pad`,
  `${COLOR_INPUT.WALL_PADDING}.column_wraps_pads`,
  `${COLOR_INPUT.CLIMBING_WALL_MAT}.climbing_wall_mat`,
];
// The labels that exist on R's "Mat/Padding Color Choices" status column.
const R_MAIN_LABELS = new Set([
  'Kelly Green', 'Navy', 'Red', 'Orange', 'Purple', 'Pink', 'Tan', 'Black', 'Lime',
  'Light Gray', 'Charcoal', 'Royal Blue', 'White', 'Yellow',
]);
const R_FORM = 'color_Mjj63A3N'; // "Color Selection Form Submitted"
const R_FORM_LABEL = {
  'Summit Adventure Series: Custom Sensory Gym': 'Adventure Series',
  'Summit Soar: Mobile Free-Standing Swing Frame': 'Summit Soar',
  'Summit Flex: Universal Exercise Unit': 'Summit Flex',
  'Summit Flex: Universal Exercise Unit & Accessories': 'Summit Flex',
  'Therapy Mats & Pads': 'Mats/Pads Only',
};
const R_REQUEST = 'project_status';

// Accessories: product → its color text columns (by part) + its request status.
const ACC_PRODUCTS = [
  {
    request: 'color_mm7e6szp', // Ball Pit - Colors Request
    parts: { [`${COLOR_INPUT.BALL_PIT}.ball_pit_vinyl`]: 'text_mm7etby1' },
  },
  {
    request: 'color_mm7eb6xn', // Foundation - Colors Request
    parts: { [`${COLOR_INPUT.FOUNDATION_MAT}.foundation_mat`]: 'text_mm7e27px' },
  },
  {
    request: 'color_mm7g5sav', // Palisades - Colors Request
    parts: {
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_1`]: 'text_mm7gyepc',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_2`]: 'text_mm7gw3tb',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_3`]: 'text_mm7gs5xs',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_4`]: 'text_mm7ggaqy',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_5`]: 'text_mm7gphmd',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_6`]: 'text_mm7g7crk',
      [`${COLOR_INPUT.PALISADES_MAT}.palisades_mat_7`]: 'text_mm7gxqhn',
    },
  },
  {
    request: 'color_mm7gvxhs', // 90 Deg Climb/Slide - Colors Request
    parts: {
      [`${COLOR_INPUT.CLIMB_SLIDE}.climb_slide_piece_1`]: 'text_mm7g8kc4',
      [`${COLOR_INPUT.CLIMB_SLIDE}.climb_slide_piece_2`]: 'text_mm7g69xn',
      [`${COLOR_INPUT.CLIMB_SLIDE}.climb_slide_piece_3`]: 'text_mm7g18bn',
    },
  },
];

function colorName(selection) {
  const color = resolveSelectedColor(selection);
  return color ? displayColorName(color) : String(selection?.code || '');
}

/**
 * Pure: what to write on each board for these confirmed selections. Only parts
 * on the order's current checklist (requiredInputs) are included. Boards with
 * nothing to write are omitted.
 */
export function planBoardWrites(order, requiredInputs, selections) {
  const picks = new Map(); // "input.part" → selection
  for (const input of requiredInputs || []) {
    for (const part of input.parts) {
      const sel = selections?.[input.input]?.[part];
      if (sel && sel.brand && sel.code) picks.set(`${input.input}.${part}`, sel);
    }
  }

  const plan = {};
  const skipped = [];

  // ── GB
  const gb = {};
  for (const [key, cols] of Object.entries(GB_PAINT)) {
    const sel = picks.get(key);
    if (!sel) continue;
    gb[cols.brand] = { label: sel.brand === 'prismatic' ? (cols.prismaticLabel || 'Prismatic (Additional Cost)') : 'Cardinal Paint (Included)' };
    gb[cols.color] = colorName(sel);
    gb[cols.code] = String(sel.code);
  }
  const slide = picks.get(`${COLOR_INPUT.SLIDE}.slide_color`);
  if (slide) gb[GB_SLIDE_COLOR] = { label: colorName(slide) };
  if (Object.keys(gb).length) {
    gb[GB_REQUEST] = { label: RECEIVED };
    plan.gb = gb;
  }

  // ── R
  const r = {};
  for (const [key, col] of Object.entries(R_TEXT)) {
    const sel = picks.get(key);
    if (!sel) continue;
    if (col) r[col] = colorName(sel);
    else skipped.push(`R: ${key} (no column yet)`);
  }
  const mainKey = R_MAIN_PRIORITY.find((k) => picks.has(k));
  if (mainKey) {
    const name = colorName(picks.get(mainKey));
    r[R_MAIN_COLOR] = { label: R_MAIN_LABELS.has(name) ? name : 'Refer to Notes' };
  }
  if (Object.keys(r).length) {
    if (R_FORM_LABEL[order?.productType]) r[R_FORM] = { label: R_FORM_LABEL[order.productType] };
    r[R_REQUEST] = { label: RECEIVED };
    plan.r = r;
  }

  // ── Accessories
  const acc = {};
  for (const product of ACC_PRODUCTS) {
    let any = false;
    for (const [key, col] of Object.entries(product.parts)) {
      const sel = picks.get(key);
      if (!sel) continue;
      acc[col] = colorName(sel);
      any = true;
    }
    if (any) acc[product.request] = { label: RECEIVED };
  }
  if (Object.keys(acc).length) plan.acc = acc;

  return { plan, skipped };
}

// ── Monday I/O ────────────────────────────────────────────────────────────

async function linkedItemsOnMfg(orderId) {
  const cols = Object.values(BOARDS).map((b) => b.mfgLink);
  const data = await mondayQuery(`
    query($id: [ID!], $cols: [String!]) {
      items(ids: $id) {
        column_values(ids: $cols) { id ... on BoardRelationValue { linked_items { id board { id } } } }
      }
    }
  `, { id: [orderId], cols });
  const out = {};
  for (const cv of data.items?.[0]?.column_values || []) out[cv.id] = cv.linked_items || [];
  return out;
}

async function findByBackLink(board, orderId) {
  let cursor = null;
  let first = true;
  do {
    const data = first
      ? await mondayQuery(`
          query($b: [ID!], $col: [String!]) {
            boards(ids: $b) { items_page(limit: 500) { cursor items { id column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } } } } }
          }
        `, { b: [board.id], col: [board.backLink] })
      : await mondayQuery(`
          query($c: String!, $col: [String!]) {
            next_items_page(cursor: $c, limit: 500) { cursor items { id column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } } } }
          }
        `, { c: cursor, col: [board.backLink] });
    const page = first ? data.boards?.[0]?.items_page : data.next_items_page;
    first = false;
    for (const item of page?.items || []) {
      const ids = (item.column_values?.[0]?.linked_item_ids || []).map(String);
      if (ids.includes(String(orderId))) return String(item.id);
    }
    cursor = page?.cursor || null;
  } while (cursor);
  return null;
}

async function backLinkIds(board, itemId) {
  const data = await mondayQuery(`
    query($i: [ID!], $col: [String!]) {
      items(ids: $i) { column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } } }
    }
  `, { i: [itemId], col: [board.backLink] });
  return (data.items?.[0]?.column_values?.[0]?.linked_item_ids || []).map(Number);
}

async function setColumns(boardId, itemId, values) {
  await mondayQuery(`
    mutation($b: ID!, $i: ID!, $v: JSON!) {
      change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id }
    }
  `, { b: boardId, i: itemId, v: JSON.stringify(values) });
}

async function createRow(boardId, name, values) {
  const data = await mondayQuery(`
    mutation($b: ID!, $n: String!, $v: JSON!) {
      create_item(board_id: $b, item_name: $n, column_values: $v) { id }
    }
  `, { b: boardId, n: name, v: JSON.stringify(values) });
  const id = data.create_item?.id;
  if (!id) throw new Error('create_item returned no id');
  return String(id);
}

/**
 * Write confirmed selections onto GB / R / Accessories. Returns a per-board
 * summary. Throws only if nothing could be attempted; per-board failures are
 * collected in `errors` so one board failing never blocks the others.
 */
export async function syncConfirmedColorsToBoards(order, requiredInputs, selections) {
  const { plan, skipped } = planBoardWrites(order, requiredInputs, selections);
  const result = { boards: {}, errors: [], skipped };
  if (!Object.keys(plan).length) return result;

  const mfgBoardId = process.env.MONDAY_BOARD_ID;
  const linked = await linkedItemsOnMfg(order.id);

  for (const [key, values] of Object.entries(plan)) {
    const board = BOARDS[key];
    try {
      const onMfg = (linked[board.mfgLink] || []).filter((it) => String(it.board?.id) === String(board.id));
      let itemId = onMfg[0] ? String(onMfg[0].id) : null;
      if (!itemId) itemId = await findByBackLink(board, order.id);

      let created = false;
      if (itemId) {
        // Add this order to the row's back-links without dropping any others.
        const back = await backLinkIds(board, itemId);
        const write = back.includes(Number(order.id))
          ? values
          : { ...values, [board.backLink]: { item_ids: [...back, Number(order.id)] } };
        await setColumns(board.id, itemId, write);
      } else {
        itemId = await createRow(board.id, order.name || String(order.id), { ...values, [board.backLink]: { item_ids: [Number(order.id)] } });
        created = true;
      }

      // Make sure Manufacturing links to the row too (its mirrors read this side).
      const existingIds = (linked[board.mfgLink] || []).map((it) => Number(it.id));
      if (!existingIds.includes(Number(itemId)) && mfgBoardId) {
        await setColumns(mfgBoardId, order.id, { [board.mfgLink]: { item_ids: [...existingIds, Number(itemId)] } });
      }
      result.boards[key] = { itemId, created };
    } catch (err) {
      result.errors.push(`${board.label}: ${err.message}`);
    }
  }
  return result;
}
