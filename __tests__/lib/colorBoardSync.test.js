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

const MFG = '6533700776';

/**
 * A tiny fake of the Monday API for these tests.
 *   mfgLinks:   { [mfgLinkColumnId]: [{ id, board }], link_to_deals__1: [...] } for the order
 *   backLinks:  { [rowId]: [orderIds] }             — each target-board row's back-link
 *   rows:       { [boardId]: [{ id, created_at }] }  — rows on each target board
 *   mfgForward: { [orderId]: { [mfgLinkColumnId]: [rowIds] } } — OTHER orders' forward links
 *   fail:       (body) => boolean                     — make a mutation fail
 */
function fakeMonday({ mfgLinks = {}, backLinks = {}, rows = {}, mfgForward = {}, fail = () => false } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (_u, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const q = body.query;
    const v = body.variables || {};
    if (q.includes('mutation')) {
      if (fail(body)) return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Monday rejected the write' }] }) };
      if (q.includes('create_item')) return ok({ create_item: { id: '777' } });
      return ok({ change_multiple_column_values: { id: 'x' } });
    }
    if (q.includes('linked_items')) {
      return ok({ items: [{ column_values: Object.entries(mfgLinks).map(([id, linked_items]) => ({ id, linked_items })) }] });
    }
    if (q.includes('items(ids')) {
      return ok({ items: [{ column_values: [{ linked_item_ids: backLinks[v.i?.[0]] || [] }] }] });
    }
    if (q.includes('items_page')) {
      const boardId = String(v.b?.[0]);
      if (boardId === MFG) {
        const col = v.col[0];
        return ok({ boards: [{ items_page: { cursor: null, items: Object.entries(mfgForward).map(([id, links]) => ({ id, column_values: [{ linked_item_ids: links[col] || [] }] })) } }] });
      }
      return ok({ boards: [{ items_page: { cursor: null, items: (rows[boardId] || []).map((r) => ({ ...r, column_values: [{ linked_item_ids: backLinks[r.id] || [] }] })) } }] });
    }
    throw new Error('unexpected ' + q);
  }));
  return calls;
}

describe('syncConfirmedColorsToBoards', () => {
  beforeEach(() => { process.env.MONDAY_BOARD_ID = MFG; });
  afterEach(() => vi.unstubAllGlobals());

  const soarOrder = { id: '555', name: 'Acme Soar', productType: SOAR, colorGates: {} };
  const soarSel = { structure_frame_paint: { soar_frame: { brand: 'cardinal', code: 'T009-BL01' } } };
  const writes = (calls) => calls.filter((c) => c.query.includes('change_multiple_column_values'));

  it("updates the row linked from Manufacturing when it belongs to this order only, marking it 'Per unique color'", async () => {
    const calls = fakeMonday({
      mfgLinks: { [BOARDS.gb.mfgLink]: [{ id: '900', board: { id: BOARDS.gb.id } }] },
      backLinks: { 900: ['555'] },
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.errors).toEqual([]);
    expect(res.boards.gb).toEqual({ itemId: '900', created: false });
    const v = JSON.parse(writes(calls)[0].variables.v);
    expect(writes(calls)[0].variables.i).toBe('900');
    expect(v.color_mkmfthfx).toEqual({ label: 'Cardinal Paint (Included)' });
    expect(v.text_mm7gyr52).toBe('Per unique color');
    expect(calls.some((c) => c.query.includes('create_item'))).toBe(false);
  });

  it('never writes onto a row shared with another order — creates a new row and says why', async () => {
    const calls = fakeMonday({
      mfgLinks: { [BOARDS.gb.mfgLink]: [{ id: '900', board: { id: BOARDS.gb.id } }] },
      backLinks: { 900: ['555', '444'] }, // also belongs to order 444
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb).toEqual({ itemId: '777', created: true });
    expect(writes(calls).some((c) => c.variables.i === '900')).toBe(false);
    expect(res.notes.join(' ')).toMatch(/shared with other order/);
  });

  it('also treats a row as shared when ANOTHER Manufacturing order links forward to it', async () => {
    const calls = fakeMonday({
      mfgLinks: { [BOARDS.gb.mfgLink]: [{ id: '900', board: { id: BOARDS.gb.id } }] },
      backLinks: { 900: ['555'] },
      mfgForward: { 444: { [BOARDS.gb.mfgLink]: ['900'] } },
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb.created).toBe(true);
    expect(writes(calls).some((c) => c.variables.i === '900')).toBe(false);
  });

  it('creates a row (name marked, Deals linked) when none exists, and links it back from Manufacturing', async () => {
    const calls = fakeMonday({ mfgLinks: { link_to_deals__1: [{ id: '42', board: { id: '6527740233' } }] } });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb).toEqual({ itemId: '777', created: true });
    const create = calls.find((c) => c.query.includes('create_item'));
    expect(create.variables.n).toBe('Acme Soar — portal');
    const v = JSON.parse(create.variables.v);
    expect(v[BOARDS.gb.backLink]).toEqual({ item_ids: [555] });
    expect(v[BOARDS.gb.dealsLink]).toEqual({ item_ids: [42] });
    const mfg = writes(calls).find((c) => c.variables.b === MFG);
    expect(JSON.parse(mfg.variables.v)[BOARDS.gb.mfgLink]).toEqual({ item_ids: [777] });
  });

  it('with several rows back-linked to this order, updates the newest and says so', async () => {
    const calls = fakeMonday({
      backLinks: { 1: ['555'], 2: ['555'], 3: ['555'] },
      rows: { [BOARDS.gb.id]: [
        { id: '1', created_at: '2026-01-01T00:00:00Z' },
        { id: '3', created_at: '2026-03-01T00:00:00Z' },
        { id: '2', created_at: '2026-02-01T00:00:00Z' },
      ] },
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb).toEqual({ itemId: '3', created: false });
    expect(res.notes.join(' ')).toMatch(/3 rows belong to this order/);
    expect(calls.some((c) => c.query.includes('create_item'))).toBe(false);
  });

  it('ignores back-linked rows that are shared with another order', async () => {
    fakeMonday({
      backLinks: { 1: ['555', '444'] },
      rows: { [BOARDS.gb.id]: [{ id: '1', created_at: '2026-01-01T00:00:00Z' }] },
    });
    const res = await syncConfirmedColorsToBoards(soarOrder, requiredColorInputs(soarOrder), soarSel);
    expect(res.boards.gb.created).toBe(true);
  });

  it('a failure on one board is reported without stopping the others', async () => {
    const both = { id: '555', name: 'Acme', productType: ADVENTURE, colorGates: { ballPitMat: 'Included' } };
    fakeMonday({
      mfgLinks: {
        [BOARDS.gb.mfgLink]: [{ id: '1', board: { id: BOARDS.gb.id } }],
        [BOARDS.r.mfgLink]: [{ id: '2', board: { id: BOARDS.r.id } }],
        [BOARDS.acc.mfgLink]: [{ id: '3', board: { id: BOARDS.acc.id } }],
      },
      backLinks: { 1: ['555'], 2: ['555'], 3: ['555'] },
      fail: (b) => b.variables.b === BOARDS.gb.id,
    });
    const res = await syncConfirmedColorsToBoards(both, requiredColorInputs(both), selections);
    expect(res.errors.some((e) => e.startsWith('GB:'))).toBe(true);
    expect(res.boards.r).toEqual({ itemId: '2', created: false });
    expect(res.boards.acc).toEqual({ itemId: '3', created: false });
  });
});

describe('planBoardWrites — label safety', () => {
  it('never writes a slide color the GB column has no label for (it would fail the whole row)', () => {
    const o = { id: '1', productType: ADVENTURE, colorGates: { slideColor: 'Included' } };
    const { plan, skipped } = planBoardWrites(o, requiredColorInputs(o), { slide: { slide_color: { brand: 'plastic', code: 'Gray' } } });
    expect(plan.gb?.status_mkkdc95c).toBeUndefined();
    expect(skipped.join(' ')).toMatch(/Gray/);
  });
});
