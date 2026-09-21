import { describe, it, expect, vi, beforeEach } from 'vitest';

// setup.js had NO test coverage at all before this file — added alongside
// the 2026-09-03 extraction of its auth/session/order-load/rate-limit
// preamble into lib/apiAuth.js (shared with pages/api/portal/color-
// selection.js), specifically to guard the most-used route in the app
// against a regression in that refactor. Not exhaustive over every tab —
// focused on the preamble (what actually changed) plus one full
// success-path round trip (the simplest tab, 'contact') proving the
// extraction didn't break the real flow into the handler's own switch.
//
// lib/apiAuth.js itself is NOT mocked — its real implementation runs,
// calling through to the mocked lib/auth/lib/monday/lib/rateLimit below.
// That's deliberate: this is exactly the code path the extraction needs
// verified, not something to bypass.

const mockGetOrderById = vi.fn();
const mockUpdateOrderColumn = vi.fn().mockResolvedValue(undefined);
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockMarkSectionCompleteSafe = vi.fn().mockResolvedValue(true);
const mockCreateDeliverySubmissionItem = vi.fn().mockResolvedValue(undefined);
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
const mockUploadFileToColumn = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  updateOrderColumn: (...args) => mockUpdateOrderColumn(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  markSectionCompleteSafe: (...args) => mockMarkSectionCompleteSafe(...args),
  createDeliverySubmissionItem: (...args) => mockCreateDeliverySubmissionItem(...args),
  setStatusLabel: (...args) => mockSetStatusLabel(...args),
  uploadFileToColumn: (...args) => mockUploadFileToColumn(...args),
  COLS: { address: 'col_address', tax_exempt_status: 'col_tax', tax_exempt_cert_file: 'col_cert' },
  STATUS_STAGES: [
    { key: 'placed' }, { key: 'in_production' }, { key: 'ready_to_ship' }, { key: 'shipped' }, { key: 'delivered' },
  ],
  TAX_EXEMPT_YES_LABEL: 'Yes',
  TAX_EXEMPT_NO_LABEL: 'No',
}));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

vi.mock('../../../lib/rateLimit', () => ({
  allowRequest: () => true,
}));

vi.mock('../../../lib/email', () => ({
  notifyTeamContactChange: vi.fn().mockResolvedValue(undefined),
  notifyTeamFormCompleted: vi.fn().mockResolvedValue(undefined),
}));

const handlerModule = await import('../../../pages/api/portal/setup.js');
const { default: handler } = handlerModule;

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

describe('setup.js — shared apiAuth preamble (extracted 2026-09-03)', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockVerifyCustomerSession.mockReset();
    mockUpdateOrderColumn.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
  });

  it('rejects a non-POST method before ever touching auth', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(mockVerifyCustomerSession).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    mockVerifyCustomerSession.mockResolvedValue(null);
    const req = { method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  // Real, intentional behavior change from the extraction: previously a
  // session with no orderId would have hit getOrderById(undefined) and
  // whatever Monday's API happens to do with that; now fails closed with a
  // clear 400, matching pages/api/portal/color-selection.js's existing
  // (pre-extraction) behavior. Every real session always has an orderId in
  // practice — this only defines what happens in the anomalous case.
  it('fails closed with a clear 400 for a session with no bound order (new — matches color-selection.js)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: null });
    const req = { method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });

  it('returns 404 when the bound order does not exist', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue(null);
    const req = { method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 (and now logs, unlike before the extraction) when the order load throws', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockRejectedValueOnce(new Error('Monday API down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = { method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('a fully valid contact-confirmation request still reaches the real handler logic end to end', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', name: 'Test Order', productType: 'Therapy Mats & Pads' });

    const req = { method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('real-order-123', 'PORTAL: Contact Confirmed', expect.any(String));
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalledWith('real-order-123', 'portalContact');
  });

  it('rejects a request missing tab/data before ever loading the order', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    const req = { method: 'POST', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });
});

// Full delivery payload with every field validateSetupData's 'delivery' case
// and the handler's own destructuring expect — individual tests below mutate
// a copy of this to isolate exactly one field at a time.
const VALID_DELIVERY_DATA = {
  pocName: 'Jane Doe',
  pocPhone: '555-111-2222',
  pocEmail: 'jane@example.com',
  addressConfirmed: true,
  formattedAddress: '123 Main St, Springfield, IL 62704',
  freightAckBy: 'Jane Doe',
  freightAckDate: '2026-09-21',
};

describe('setup.js — delivery tab: PORTAL-018 freight-ack server-side validation', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockVerifyCustomerSession.mockReset();
    mockUpdateOrderColumn.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockCreateDeliverySubmissionItem.mockReset().mockResolvedValue(undefined);
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    // stageIndex 0 ('placed') is well below STATUS_STAGES' 'shipped' index,
    // so isOrderShipped() never blocks these tests.
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', name: 'Test Order', stageIndex: 0 });
  });

  // Before this fix, freightAckBy/freightAckDate were not checked by
  // validateSetupData at all — a direct/scripted POST omitting them still
  // passed validation and reached the handler body, where
  // `if (freightAckBy && freightAckDate)` simply skipped posting the
  // acknowledgment update, and markSectionCompleteSafe(..., 'portalDelivery')
  // still ran unconditionally — marking Delivery fully complete with no
  // freight acknowledgment ever recorded. This test would have FAILED before
  // the fix (res.statusCode would have been 200, not 400).
  it('rejects a delivery submission missing freightAckBy with a 400, before ever writing to Monday', async () => {
    const { freightAckBy, ...rest } = VALID_DELIVERY_DATA;
    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: rest } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/freight/i);
    expect(mockGetOrderById).not.toHaveBeenCalled();
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
  });

  it('rejects a delivery submission missing freightAckDate with a 400', async () => {
    const { freightAckDate, ...rest } = VALID_DELIVERY_DATA;
    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: rest } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/acknowledgment date/i);
  });

  it('rejects a delivery submission where freightAckBy is blank/whitespace', async () => {
    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: { ...VALID_DELIVERY_DATA, freightAckBy: '   ' } } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('accepts a fully valid delivery submission (both freight-ack fields present) and marks it complete', async () => {
    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith(
      'real-order-123', 'PORTAL: Freight Delivery Acknowledgment', expect.any(String)
    );
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalledWith('real-order-123', 'portalDelivery');
  });
});

describe('setup.js — delivery tab: idempotency guard against retry-duplicated side effects', () => {
  // The dedup guard's Map is module-scoped state in setup.js (deliberately —
  // it has to survive across requests/invocations to catch a real retry, the
  // same reason lib/rateLimit.js's `buckets` is module-scoped), so it is NOT
  // reset between tests the way the mocks above are. Each test below uses
  // its own never-reused order id so tests can't observe each other's
  // recorded submissions.
  let orderCounter = 0;
  function nextOrderId() {
    orderCounter += 1;
    return `dedup-order-${orderCounter}`;
  }

  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockVerifyCustomerSession.mockReset();
    mockUpdateOrderColumn.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockCreateDeliverySubmissionItem.mockReset().mockResolvedValue(undefined);
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'unused-session-order-id' });
  });

  // Before this fix, createDeliverySubmissionItem() and notifyTeamContactChange()
  // ran unconditionally on every 'delivery' POST — a customer's natural retry
  // after a lost/slow response (the first request having actually already
  // succeeded server-side) created a second Delivery & Site Details
  // Submissions board row and a second staff email. This test sends the exact
  // same payload twice in immediate succession and would have FAILED before
  // the fix (mockCreateDeliverySubmissionItem would show 2 calls, not 1).
  it('does not create a second submissions-board row or notification when the identical payload is retried immediately', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Dedup Order', stageIndex: 0 });

    const req1 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res1 = makeRes();
    await handler(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(1);

    const req2 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res2 = makeRes();
    await handler(req2, res2);

    // The retry still succeeds (still marks the section complete — the
    // customer's request wasn't rejected) but the duplicate-creating side
    // effects are skipped.
    expect(res2.statusCode).toBe(200);
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(1);
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalledTimes(2);
  });

  it('DOES create a second submissions-board row when the resubmission has genuinely different content', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Dedup Order', stageIndex: 0 });

    const req1 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    await handler(req1, makeRes());
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(1);

    const changed = { ...VALID_DELIVERY_DATA, specialInstructions: 'Actually, call ahead first.' };
    const req2 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: changed } };
    const res2 = makeRes();
    await handler(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(2);
  });

  it('treats the identical payload from a DIFFERENT order as a fresh submission, not a duplicate', async () => {
    const orderIdA = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderIdA, name: 'Order A', stageIndex: 0 });
    const req1 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    await handler(req1, makeRes());
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(1);

    // A different order submitting the identical payload is NOT a duplicate
    // of the first order's submission — the guard is keyed per-order.
    const orderIdB = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderIdB, name: 'Order B', stageIndex: 0 });
    const req2 = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res2 = makeRes();
    await handler(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(2);
  });
});
