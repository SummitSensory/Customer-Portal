import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { planBoardWrites, syncConfirmedColorsToBoards, BOARDS } from '../../lib/colorBoardSync';
import { requiredColorInputs } from '../../lib/colorRequirements';

const ADVENTURE = 'Summit Adventure Series: Custom Sensory Gym';
const SOAR = 'Summit Soar: Mobile Free-Standing Swing Frame';

// Every buildable gate Included, so every board has something to write.
const order = {
  id: '12964352339', name: 'Diverse Options (Adventure Series)', productType: ADVENTURE,
  colorGates: {
    adventureMat: 'Included', climbingWallColor: 'Included', climbingWallMat: 'Included',
    wallPaddingMat: 'Included', slideColor: 'Included', ballPitMat: 'Included',
    palisadesMat: 'Included', climbSlideMat: 'Included', foundationMat: 'Included',
  },
};
const selections = {
  structure_frame_paint: {
    legs: { brand: 'cardinal', code: 'T009-BL01' },
    horizontal_beams: { brand: 'prismatic', code: 'PRB-4432' },
    ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-YL01' },
  },
  climbing_wall_color: { climbing_wall: { brand: 'cardinal', code: 'P000-BK247' } },
  slide_platform_paint: { slide_platform: { brand: 'cardinal', code: 'T009-BL01' } },
  slide: { slide_color: { brand: 'plastic', code: 'Green' } },
  adventure_mat: { adventure_mat_system: { brand: 'vinyl', code: 'Lime' } },
  climbing_wall_mat: { climbing_wall_mat: { brand: 'vinyl', code: 'Navy' } },
  wall_padding_mat: { column_wraps_pads: { brand: 'vinyl', code: 'Red' } },
  ball_pit: { ball_pit_vinyl: { brand: 'vinyl', code: 'Yellow' } },
  palisades_mat: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`palisades_mat_${n}`, { brand: 'vinyl', code: n % 2 ? 'Black' : 'White' }])),
  climb_slide_mat: {
    climb_slide_piece_1: { brand: 'vinyl', code: 'Royal Blue' },
    climb_slide_piece_2: { brand: 'vinyl', code: 'Orange' },
    climb_slide_piece_3: { brand: 'vinyl', code: 'Kelly Green' },
  },
  foundation_mat: { foundation_mat: { brand: 'foundation', code: 'Red/Blue' } },
};

describe('planBoardWrites', () => {
  const { plan } = planBoardWrites(order, requiredColorInputs(order), selections);

  it('GB: brand label, color name and code per painted part; slide color; Received', () => {
    expect(plan.gb.status__1).toEqual({ label: 'Cardinal Paint (Included)' });
    expect(plan.gb.text_Mjj6nXbz).toBe('T009-BL01');
    expect(plan.gb.text__1).toBeTruthy();
    expect(plan.gb.color_mkkdmta3).toEqual({ label: 'Prismatic (Additional Cost)' });
    expect(plan.gb.text_mkkdxnmq).toBe('PRB-4432');
    expect(plan.gb.color_mkkdkegr).toEqual({ label: 'Cardinal Paint (Included)' }); // slide platform is paint now
    expect(plan.gb.text_mkkdxjxv).toBe('P000-BK247'); // climbing wall
    expect(plan.gb.status_mkkdc95c).toEqual({ label: 'Green' });
    expect(plan.gb.project_status).toEqual({ label: 'Received' });
  });

  it('R: one text column per area, the main status, form label and Received', () => {
    expect(plan.r.text_mm7g7g9q).toBe('Lime'); // Adventure Mat System
    expect(plan.r.text_mm7gas1b).toBe('Navy'); // Climbing Wall Mat
    expect(plan.r.text_mm7gg5n4).toBe('Red'); // Wall Padding
    expect(plan.r.status9__1).toEqual({ label: 'Lime' }); // main = Adventure Mat System
    expect(plan.r.color_Mjj63A3N).toEqual({ label: 'Adventure Series' });
    expect(plan.r.project_status).toEqual({ label: 'Received' });
  });

  it('Accessories: ball pit, 7 Palisades pieces, 3 climb & slide pieces, foundation, each product Received', () => {
    expect(plan.acc.text_mm7etby1).toBe('Yellow');
    expect(plan.acc.color_mm7e6szp).toEqual({ label: 'Received' });
    expect(plan.acc.text_mm7gyepc).toBe('Black'); // Palisades 1
    expect(plan.acc.text_mm7gw3tb).toBe('White'); // Palisades 2
    expect(plan.acc.text_mm7gxqhn).toBe('Black'); // Palisades 7
    expect(plan.acc.color_mm7g5sav).toEqual({ label: 'Received' });
    expect(plan.acc.text_mm7g8kc4).toBe('Royal Blue');
    expect(plan.acc.text_mm7g69xn).toBe('Orange');
    expect(plan.acc.text_mm7g18bn).toBe('Kelly Green');
    expect(plan.acc.color_mm7gvxhs).toEqual({ label: 'Received' });
    expect(plan.acc.text_mm7e27px).toBe('Red/Blue');
    expect(plan.acc.color_mm7eb6xn).toEqual({ label: 'Received' });
  });

  it('only writes parts on the current checklist, and skips boards with nothing to write', () => {
    const soarOnly = { id: '1', productType: SOAR, colorGates: { soarMat: 'NOT Included' } };
    const { plan: p } = planBoardWrites(soarOnly, requiredColorInputs(soarOnly), {
      structure_frame_paint: { soar_frame: { brand: 'prismatic', code: 'PRB-4432' } },
      ball_pit: { ball_pit_vinyl: { brand: 'vinyl', code: 'Yellow' } }, // not on this order's checklist
    });
    expect(p.gb.color_mkmfthfx).toEqual({ label: 'Prismatic (+$350.00)' }); // Soar/Flex use their own label
    expect(p.acc).toBeUndefined();
    expect(p.r).toBeUndefined();
  });
});

// ── I/O ────────────────────────────────────────────────────────────────────
function ok(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

describe('syncConfirmedColorsToBoards', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.MONDAY_BOARD_ID = '6533700776';
  });
  afterEach(() => vi.unstubAllGlobals());

  function stub(handler) {
    vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return ok(handler(body));
    }));
  }
  const soarOrder = { id: '555', name: 'Acme Soar', productType: SOAR, colorGates: {} };
  const soarSel = { structure_frame_paint: { soar_frame: { brand: 'cardinal', code: 'T009-BL01' } } };

  it('uses the row linked from Manufacturing, keeps its existing back-links, and does not create one', async () => {
    stub((b) => {
      if (b.query.includes('linked_items')) return { items: [{ column_values: [{ id: BOARDS.gb.mfgLink, linked_items: [{ id: '900', board: { id: BOARDS.gb.id } }] }] }] };
      if (b.query.includes('linked_item_ids') && b.query.includes('items(ids')) return { items: [{ column_values: [{ linked_item_ids: ['111'] }] }] };
      if (b.query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: '900' } };
      throw new Error('unexpected ' + b.query);
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.errors).toEqual([]);
    expect(res.boards.gb).toEqual({ itemId: '900', created: false });
    const write = calls.find((c) => c.query.includes('change_multiple_column_values'));
    expect(write.variables.i).toBe('900');
    const v = JSON.parse(write.variables.v);
    expect(v[BOARDS.gb.backLink]).toEqual({ item_ids: [111, 555] }); // 111 kept
    expect(v.color_mkmfthfx).toEqual({ label: 'Cardinal Paint (Included)' });
    expect(calls.some((c) => c.query.includes('create_item'))).toBe(false);
  });

  it('creates a row when none is linked either way, and links it back from Manufacturing', async () => {
    stub((b) => {
      if (b.query.includes('linked_items')) return { items: [{ column_values: [] }] };
      if (b.query.includes('items_page')) return { boards: [{ items_page: { cursor: null, items: [{ id: '1', column_values: [{ linked_item_ids: ['999'] }] }] } }] };
      if (b.query.includes('create_item')) return { create_item: { id: '777' } };
      if (b.query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: '555' } };
      throw new Error('unexpected ' + b.query);
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.errors).toEqual([]);
    expect(res.boards.gb).toEqual({ itemId: '777', created: true });
    const create = calls.find((c) => c.query.includes('create_item'));
    expect(create.variables.n).toBe('Acme Soar');
    expect(JSON.parse(create.variables.v)[BOARDS.gb.backLink]).toEqual({ item_ids: [555] });
    const mfgLink = calls.find((c) => c.query.includes('change_multiple_column_values'));
    expect(mfgLink.variables.b).toBe('6533700776');
    expect(JSON.parse(mfgLink.variables.v)[BOARDS.gb.mfgLink]).toEqual({ item_ids: [777] });
  });

  it('finds a row by its back-link when Manufacturing has no link to it', async () => {
    stub((b) => {
      if (b.query.includes('linked_items')) return { items: [{ column_values: [] }] };
      if (b.query.includes('items_page')) return { boards: [{ items_page: { cursor: null, items: [{ id: '321', column_values: [{ linked_item_ids: ['555'] }] }] } }] };
      if (b.query.includes('linked_item_ids') && b.query.includes('items(ids')) return { items: [{ column_values: [{ linked_item_ids: ['555'] }] }] };
      if (b.query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'x' } };
      throw new Error('unexpected ' + b.query);
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb).toEqual({ itemId: '321', created: false });
    expect(calls.some((c) => c.query.includes('create_item'))).toBe(false);
  });

  it('a failure on one board is reported without stopping the others', async () => {
    const both = { id: '555', name: 'Acme', productType: ADVENTURE, colorGates: { ballPitMat: 'Included' } };
    const sel = { ...selections };
    stub((b) => {
      if (b.query.includes('linked_items')) return { items: [{ column_values: [
        { id: BOARDS.gb.mfgLink, linked_items: [{ id: '1', board: { id: BOARDS.gb.id } }] },
        { id: BOARDS.acc.mfgLink, linked_items: [{ id: '3', board: { id: BOARDS.acc.id } }] },
        { id: BOARDS.r.mfgLink, linked_items: [{ id: '2', board: { id: BOARDS.r.id } }] },
      ] }] };
      if (b.query.includes('linked_item_ids') && b.query.includes('items(ids')) return { items: [{ column_values: [{ linked_item_ids: ['555'] }] }] };
      if (b.query.includes('change_multiple_column_values') && b.variables.b === BOARDS.gb.id) throw new Error('GB down');
      if (b.query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'x' } };
      throw new Error('unexpected ' + b.query);
    });
    // The fetch stub throwing becomes a rejected mondayQuery.
    const res = await syncConfirmedColorsToBoards(both, requiredColorInputs(both), sel);
    expect(res.errors.some((e) => e.startsWith('GB:'))).toBe(true);
    expect(res.boards.acc).toBeTruthy();
    expect(res.boards.r).toBeTruthy();
  });
});
