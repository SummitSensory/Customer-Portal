import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockMarkSectionCompleteSafe = vi.fn().mockResolvedValue(true);
const mockWriteColorSelectionSnapshot = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  markSectionCompleteSafe: (...args) => mockMarkSectionCompleteSafe(...args),
  writeColorSelectionSnapshot: (...args) => mockWriteColorSelectionSnapshot(...args),
}));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

vi.mock('../../../lib/rateLimit', () => ({
  allowRequest: () => true,
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const mockNotifyColorsConfirmed = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  notifyTeamColorsConfirmed: (...args) => mockNotifyColorsConfirmed(...args),
}));

const mockSyncBoards = vi.fn().mockResolvedValue({ boards: {}, errors: [], skipped: [] });
vi.mock('../../../lib/colorBoardSync', () => ({
  syncConfirmedColorsToBoards: (...args) => mockSyncBoards(...args),
}));

const handlerModule = await import('../../../pages/api/portal/color-selection.js');
const { default: handler, validateColorSelectionData, computeTotalUpcharge } = handlerModule;

const ADVENTURE_SERIES = 'Summit Adventure Series: Custom Sensory Gym';

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

// The handler's confirm path now reads the order THREE times (initial load,
// re-check-before-write, and a post-write race-detection verification —
// 2026-09-03) — a plain mockResolvedValue(base) makes every call return the
// same never-confirmed order, which the verification read would then
// wrongly interpret as "a different request's write landed after mine"
// (see the "confirm-race" test below for what a REAL mismatch looks like).
// This reflects whatever was actually passed to writeColorSelectionSnapshot
// once a write has happened, matching real behavior: Monday's read-your-
// own-write is immediate, no eventual-consistency lag.
function mockOrderReflectingWrites(base) {
  mockGetOrderById.mockImplementation(() => {
    const lastWrite = mockWriteColorSelectionSnapshot.mock.calls.at(-1);
    return Promise.resolve(lastWrite ? { ...base, colorSelectionSnapshot: lastWrite[1] } : base);
  });
}

// Matches the final 2026-09-21 model (lib/colorRequirements.js), after a
// real back-and-forth with Bryan: the steel frame (legs/horizontal beams/
// ladder) is Cardinal/Prismatic (structure_frame_paint), restored to match
// the original pre-redesign behavior. Climbing Wall is its own separate
// Cardinal/Prismatic gate (climbing_wall_color). Zip Line is vinyl, folded
// into Adventure-Mat Color (adventure_mat) — its only part. Built with no
// colorGates/colorFrameType set on `order`, so every buildable gate AND
// the steel frame (inferred from productType) are required — the
// fail-closed default.
function fullValidSelections() {
  return {
    structure_frame_paint: {
      legs: { brand: 'cardinal', code: 'T009-BG01' },
      horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
      ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-BG01' },
    },
    climbing_wall_color: {
      climbing_wall: { brand: 'cardinal', code: 'T009-BG01' },
    },
    adventure_mat: {
      adventure_mat_system: { brand: 'vinyl', code: 'Black' },
    },
    wall_padding_mat: {
      column_wraps_pads: { brand: 'vinyl', code: 'Black' },
    },
    slide_platform_paint: {
      slide_platform: { brand: 'cardinal', code: 'T009-BG01' },
    },
    slide: {
      slide_color: { brand: 'plastic', code: 'Blue' },
    },
    climbing_wall_mat: {
      climbing_wall_mat: { brand: 'vinyl', code: 'Black' },
    },
    ball_pit: {
      ball_pit_vinyl: { brand: 'vinyl', code: 'Black' },
    },
  };
}

describe('validateColorSelectionData (pure)', () => {
  const order = { productType: ADVENTURE_SERIES };

  it('accepts a fully valid submission', () => {
    expect(validateColorSelectionData(order, fullValidSelections())).toBeNull();
  });

  it('rejects a submission missing a required part', () => {
    const s = fullValidSelections();
    delete s.structure_frame_paint.legs;
    expect(validateColorSelectionData(order, s)).toMatch(/legs/);
  });

  it('rejects an unrecognized catalog code — never trusts a client-supplied color', () => {
    const s = fullValidSelections();
    s.adventure_mat.adventure_mat_system = { brand: 'vinyl', code: 'MADE-UP-COLOR' };
    expect(validateColorSelectionData(order, s)).toMatch(/adventure_mat_system/);
  });

  it('rejects an unsupported product type outright', () => {
    expect(validateColorSelectionData({ productType: 'Ball Pit' }, fullValidSelections()))
      .toMatch(/isn't available/);
  });
});

describe('validateColorSelectionData — Mat & Pad Color (vinyl)', () => {
  const matOrder = { productType: 'Therapy Mats & Pads' };

  it('accepts a real, catalog-valid vinyl color', () => {
    const s = { mat_pad_color: { mat_pad: { brand: 'vinyl', code: 'Kelly Green' } } };
    expect(validateColorSelectionData(matOrder, s)).toBeNull();
  });

  it('rejects a made-up vinyl color name — never trusts client input', () => {
    const s = { mat_pad_color: { mat_pad: { brand: 'vinyl', code: 'Mauve' } } };
    expect(validateColorSelectionData(matOrder, s)).toMatch(/mat_pad/);
  });

  it('vinyl selections never contribute a Prismatic upcharge', () => {
    const s = { mat_pad_color: { mat_pad: { brand: 'vinyl', code: 'Kelly Green' } } };
    expect(computeTotalUpcharge(matOrder, s)).toBe(0);
  });

  it('rejects a real, valid Prismatic PAINT sku on a Mat & Pad part — wrong category, even though the code itself is real (regression, found in code review 2026-09-01)', () => {
    const s = { mat_pad_color: { mat_pad: { brand: 'prismatic', code: 'PRB-10395' } } };
    expect(validateColorSelectionData(matOrder, s)).toMatch(/mat_pad/);
  });
});

describe('validateColorSelectionData — brand must be allowed for the part (regression, found in code review 2026-09-01)', () => {
  it('rejects a real, valid vinyl color on a structural paint part', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'vinyl', code: 'Kelly Green' };
    expect(validateColorSelectionData({ productType: ADVENTURE_SERIES }, s)).toMatch(/legs/);
  });

  it('rejects a real, valid Cardinal paint code on a vinyl (adventure_mat) part', () => {
    const s = fullValidSelections();
    s.adventure_mat.adventure_mat_system = { brand: 'cardinal', code: 'T009-BG01' };
    expect(validateColorSelectionData({ productType: ADVENTURE_SERIES }, s)).toMatch(/adventure_mat_system/);
  });
});

describe('computeTotalUpcharge (pure)', () => {
  const order = { productType: ADVENTURE_SERIES };

  it('is $0 when every selection is Cardinal/vinyl (no Prismatic upcharge)', () => {
    expect(computeTotalUpcharge(order, fullValidSelections())).toBe(0);
  });

  it('prices the first Prismatic selection at $500 (steel frame legs)', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'prismatic', code: 'PRB-10395' };
    expect(computeTotalUpcharge(order, s)).toBe(500);
  });

  it('prices a second, distinct Prismatic selection at +$300 — Climbing Wall is its own independent Cardinal/Prismatic gate', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'prismatic', code: 'PRB-10395' };
    s.climbing_wall_color.climbing_wall = { brand: 'prismatic', code: 'PRB-4432' };
    expect(computeTotalUpcharge(order, s)).toBe(800);
  });
});

describe('handler — auth and customer isolation', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockVerifyCustomerSession.mockReset();
    mockWriteColorSelectionSnapshot.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
  });

  it('rejects an unauthenticated request', async () => {
    mockVerifyCustomerSession.mockResolvedValue(null);
    const req = { method: 'GET', headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a session with no bound order', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: null });
    const req = { method: 'GET', headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('ONLY ever loads the order bound to the session — a client-supplied orderId in the body is ignored entirely', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const req = {
      method: 'POST',
      headers: {},
      // An attacker-style attempt to target a different order via the body.
      // The handler must never read this field — isolation comes entirely
      // from the server-derived session.orderId, never from client input.
      body: { orderId: 'someone-elses-order-999', selections: fullValidSelections(), confirm: false },
    };
    const res = makeRes();
    await handler(req, res);

    expect(mockGetOrderById).toHaveBeenCalledWith('real-order-123');
    expect(mockGetOrderById).not.toHaveBeenCalledWith('someone-elses-order-999');
    expect(mockWriteColorSelectionSnapshot).toHaveBeenCalledWith('real-order-123', expect.anything());
    expect(res.statusCode).toBe(200);
  });

  it('rejects a fabricated catalog code on an ordinary AUTOSAVE (confirm:false) — never prices or persists it (regression, found in code review 2026-09-01)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'prismatic', code: 'FAKE-SKU-DOES-NOT-EXIST' };

    const req = { method: 'POST', headers: {}, body: { selections: s, confirm: false } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
  });

  it('rejects any further write once confirmedAt is already set — autosave included, no exceptions', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({
      id: 'real-order-123',
      productType: ADVENTURE_SERIES,
      colorSelectionSnapshot: { selections: fullValidSelections(), confirmedAt: '2026-08-30T00:00:00.000Z' },
    });

    const changed = fullValidSelections();
    changed.structure_frame_paint.legs = { brand: 'cardinal', code: 'P009-BG02' };

    const req = { method: 'POST', headers: {}, body: { selections: changed, confirm: false } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a re-confirm attempt too, not just plain autosave, once already confirmed', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({
      id: 'real-order-123',
      productType: ADVENTURE_SERIES,
      colorSelectionSnapshot: { selections: fullValidSelections(), confirmedAt: '2026-08-30T00:00:00.000Z' },
    });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
  });

  it('confirming with an incomplete selection is rejected server-side, even if the client thinks it is done', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const incomplete = fullValidSelections();
    delete incomplete.adventure_mat.adventure_mat_system;

    const req = { method: 'POST', headers: {}, body: { selections: incomplete, confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
  });

  // Real race found by independent code review (2026-09-02): the confirmedAt
  // check at the top of the request reads `order` once — there's no
  // compare-and-swap on a Monday text column, so a request that read
  // "not yet confirmed" can still be mid-flight when a DIFFERENT request
  // (another tab, a duplicate/retried request) confirms in between. The fix
  // re-reads immediately before the write; this simulates exactly that
  // window by making the two getOrderById calls return different answers.
  it('rejects an autosave that was already in flight when a DIFFERENT request confirmed in between (re-check-before-write)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById
      .mockResolvedValueOnce({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null })
      .mockResolvedValueOnce({
        id: 'real-order-123',
        productType: ADVENTURE_SERIES,
        colorSelectionSnapshot: { selections: fullValidSelections(), confirmedAt: '2026-09-02T12:00:00.000Z' },
      });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: false } };
    const res = makeRes();
    await handler(req, res);

    expect(mockGetOrderById).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(409);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
  });

  it('DOES re-check before write on a confirm request too, not just autosave (found in a later review pass, 2026-09-03)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    // 3 calls: initial load, re-check-before-write, post-write race check.
    expect(mockGetOrderById).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(200);
  });

  // Review 2026-09-23: confirming used to email nobody, so an upcharge could go unbilled.
  it('emails staff with the total upcharge on confirm', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', name: 'Acme Gym', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockNotifyColorsConfirmed.mockClear();

    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockNotifyColorsConfirmed).toHaveBeenCalledWith('Acme Gym', 'a@b.com', res.body.totalUpcharge, expect.objectContaining({ errors: [] }));
  });

  it('fills the staff color boards on confirm, with the order checklist and the cleaned selections', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', name: 'Acme Gym', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockSyncBoards.mockClear();

    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockSyncBoards).toHaveBeenCalledTimes(1);
    const [order, inputs, selections] = mockSyncBoards.mock.calls[0];
    expect(order.id).toBe('real-order-123');
    expect(inputs.length).toBeGreaterThan(0);
    expect(selections.adventure_mat.adventure_mat_system.code).toBe('Black');
  });

  it('a board-sync failure alerts staff but never fails the confirm', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', name: 'Acme Gym', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockSyncBoards.mockResolvedValueOnce({ boards: { gb: { itemId: '1', created: false } }, errors: ['R: label missing'], skipped: [] });
    mockReportCriticalFailure.mockClear();

    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('color-selection-board-sync', expect.stringContaining('R: label missing'), expect.anything());
  });

  it('does not touch the boards on an autosave (only on confirm)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', name: 'Acme Gym', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockSyncBoards.mockClear();
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { selections: fullValidSelections() } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockSyncBoards).not.toHaveBeenCalled();
  });

  it('a failed confirm email with an upcharge attached raises an alert, and the confirm still succeeds', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    const sel = fullValidSelections();
    sel.structure_frame_paint.legs = { brand: 'prismatic', code: 'PRB-4432' };
    mockOrderReflectingWrites({ id: 'real-order-123', name: 'Acme Gym', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockNotifyColorsConfirmed.mockRejectedValueOnce(new Error('resend down'));
    mockReportCriticalFailure.mockClear();

    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { selections: sel, confirm: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.totalUpcharge).toBe(500);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('color-selection-confirm-email', expect.stringContaining('$500'), expect.objectContaining({ totalUpcharge: 500 }));
  });

  it('rejects a confirm request that was in flight when a DIFFERENT concurrent confirm already landed — closes the double-confirm race, not just the confirm-after-autosave one', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById
      .mockResolvedValueOnce({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null })
      .mockResolvedValueOnce({
        id: 'real-order-123',
        productType: ADVENTURE_SERIES,
        colorSelectionSnapshot: { selections: fullValidSelections(), confirmedAt: '2026-09-03T12:00:00.000Z' },
      });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(mockWriteColorSelectionSnapshot).not.toHaveBeenCalled();
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
  });

  // Real gap found by independent code review (2026-09-02): neither
  // validation function rejects extra top-level keys or oversized values —
  // this proves the handler itself strips them before persisting, via
  // sanitizeSelections, regardless of what a request body contains.
  it('never persists an unrecognized extra key in the request body, however large', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const s = fullValidSelections();
    s.junk = 'x'.repeat(500_000);

    const req = { method: 'POST', headers: {}, body: { selections: s, confirm: false } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const [, persisted] = mockWriteColorSelectionSnapshot.mock.calls[0];
    expect(persisted.selections.junk).toBeUndefined();
    expect(persisted.selections.structure_frame_paint.legs).toEqual({ brand: 'cardinal', code: 'T009-BG01' });
  });

  // Real gap found by independent code review (2026-09-02): this used to be
  // `.catch(console.error)` — a real confirmation with no signal to staff at
  // all if the audit-trail update failed. The snapshot write and completion
  // flag (the parts that actually matter) must still succeed for the
  // customer; staff visibility into the failure goes through the same
  // alerting path as every other silent-failure class in this codebase.
  it('still returns success when the audit-trail update fails on confirm, but reports it rather than swallowing it', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });
    mockPostTaggedUpdate.mockRejectedValue(new Error('Monday API unavailable'));

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.auditUpdatePending).toBe(true);
    expect(mockWriteColorSelectionSnapshot).toHaveBeenCalled();
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalled();
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'color-selection-confirm',
      expect.stringContaining('real-order-123'),
      expect.objectContaining({ orderId: 'real-order-123' })
    );
  });

  it('reports auditUpdatePending: false on the ordinary success path', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.body.auditUpdatePending).toBe(false);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });

  // Decision (2026-09-03): Monday's API has no compare-and-swap, so the
  // re-check-before-write above narrows the confirm/autosave race to a
  // single read-then-write gap but can't eliminate it outright. This is the
  // additive detection layer: it can't prevent a genuinely simultaneous
  // second write from landing after this one, but it does mean the race
  // gets flagged for staff instead of silently going unnoticed.
  it('reports a critical failure when a post-write read-back shows a DIFFERENT confirmation than this request just wrote — a race actually landed', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById
      .mockResolvedValueOnce({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null }) // initial load
      .mockResolvedValueOnce({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null }) // re-check
      .mockResolvedValueOnce({ // post-write verification: a DIFFERENT confirmation is now stored
        id: 'real-order-123',
        productType: ADVENTURE_SERIES,
        colorSelectionSnapshot: { selections: fullValidSelections(), confirmedAt: '2026-09-03T05:00:00.000Z' },
      });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    // The write already succeeded from this request's own point of view —
    // it must still report success, not retroactively fail the customer's
    // action over a race it can only detect, not undo.
    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'color-selection-confirm-race',
      expect.stringContaining('real-order-123'),
      expect.objectContaining({ orderId: 'real-order-123' })
    );
  });

  it('does NOT report a race when the post-write read-back correctly reflects the write that was just made', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const req = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });

  // Real race found by independent code review (2026-09-09): the previous
  // re-check-before-write only ever catches a concurrent write that lands
  // BEFORE its own verification read — a slower autosave whose write lands
  // AFTER a confirm has already verified successfully could silently revert
  // confirmedAt back to null, with no alert, since the confirm's own
  // verification read already ran (and matched) before the trailing
  // autosave ever wrote. withOrderLock (see pages/api/portal/color-
  // selection.js) is the actual fix: two requests for the SAME order can
  // never run their read-validate-write sequence concurrently, so whichever
  // one's turn comes second is forced to re-read AFTER the first one's
  // entire sequence — including its write — has already landed.
  //
  // This fires both requests genuinely concurrently (no await between the
  // two handler() calls) against a shared mock that reflects whatever was
  // actually last written, the same real interleaving the lock exists to
  // serialize — not two sequential calls with a pre-scripted mock queue
  // (which every other race test above already covers for the narrower,
  // single-read-then-write window).
  it('a trailing autosave cannot land after a concurrent confirm already verified successfully (per-order lock closes the true confirm-lock race)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderReflectingWrites({ id: 'real-order-123', productType: ADVENTURE_SERIES, colorSelectionSnapshot: null });

    const confirmReq = { method: 'POST', headers: {}, body: { selections: fullValidSelections(), confirm: true } };
    const confirmRes = makeRes();

    const trailingSelections = fullValidSelections();
    trailingSelections.structure_frame_paint.legs = { brand: 'cardinal', code: 'P009-BG02' };
    const autosaveReq = { method: 'POST', headers: {}, body: { selections: trailingSelections, confirm: false } };
    const autosaveRes = makeRes();

    // Genuinely concurrent: both handler() calls start (and run up to their
    // first await) before either has finished, exactly like two real
    // in-flight requests for the same order hitting the same warm instance.
    await Promise.all([
      handler(confirmReq, confirmRes),
      handler(autosaveReq, autosaveRes),
    ]);

    // Whichever request's turn ran second re-read the order AFTER the
    // first one's write had already landed — so it's impossible for both
    // to have proceeded past the confirmedAt guard. Exactly one of the two
    // must have been rejected as already-confirmed.
    const statuses = [confirmRes.statusCode, autosaveRes.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    // Whatever the final persisted state is, confirmedAt must still be set
    // — the exact bug this closes was a trailing autosave silently
    // reverting a just-confirmed order's confirmedAt back to null.
    const finalWrite = mockWriteColorSelectionSnapshot.mock.calls.at(-1);
    expect(finalWrite[1].confirmedAt).not.toBeNull();
    // No unconfirmed request should ever have been allowed to write once
    // the order was confirmed — the 409'd request must not have persisted
    // anything of its own after the confirm's write landed.
    expect(mockWriteColorSelectionSnapshot).toHaveBeenCalledTimes(1);
  });
});
