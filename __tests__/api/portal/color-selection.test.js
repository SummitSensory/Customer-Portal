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

function fullValidSelections() {
  return {
    structure_frame_paint: {
      legs: { brand: 'cardinal', code: 'T009-BG01' },
      horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' },
      ladder_rungs_and_leg: { brand: 'cardinal', code: 'T009-BG01' },
      slide_platform: { brand: 'cardinal', code: 'T009-BG01' },
      slide_color: { brand: 'cardinal', code: 'T009-BG01' },
      climbing_wall: { brand: 'cardinal', code: 'T009-BG01' },
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
    delete s.structure_frame_paint.climbing_wall;
    expect(validateColorSelectionData(order, s)).toMatch(/climbing_wall/);
  });

  it('rejects an unrecognized catalog code — never trusts a client-supplied color', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'cardinal', code: 'MADE-UP-CODE' };
    expect(validateColorSelectionData(order, s)).toMatch(/legs/);
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
});

describe('computeTotalUpcharge (pure)', () => {
  const order = { productType: ADVENTURE_SERIES };

  it('is $0 when every selection is Cardinal (no Prismatic upcharge)', () => {
    expect(computeTotalUpcharge(order, fullValidSelections())).toBe(0);
  });

  it('prices the first Prismatic selection at $500', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'prismatic', code: 'PRB-10395' };
    expect(computeTotalUpcharge(order, s)).toBe(500);
  });

  it('prices a second Prismatic selection at +$300, not another $500', () => {
    const s = fullValidSelections();
    s.structure_frame_paint.legs = { brand: 'prismatic', code: 'PRB-10395' };
    s.structure_frame_paint.horizontal_beams = { brand: 'prismatic', code: 'PRB-4432' };
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
    delete incomplete.structure_frame_paint.slide_color;

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
});
