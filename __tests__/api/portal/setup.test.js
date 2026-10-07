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
const mockFindRecentDeliverySubmission = vi.fn().mockResolvedValue(null);
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
const mockUploadFileToColumn = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  updateOrderColumn: (...args) => mockUpdateOrderColumn(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  markSectionCompleteSafe: (...args) => mockMarkSectionCompleteSafe(...args),
  createDeliverySubmissionItem: (...args) => mockCreateDeliverySubmissionItem(...args),
  findRecentDeliverySubmission: (...args) => mockFindRecentDeliverySubmission(...args),
  setStatusLabel: (...args) => mockSetStatusLabel(...args),
  uploadFileToColumn: (...args) => mockUploadFileToColumn(...args),
  // AUDIT-2026-10-06: lib/apiAuth.js re-checks order ownership via this;
  // the fixture orders here carry no customerEmail, so it's stubbed to
  // "owned" (lib/apiAuth.test.js covers the real check directly).
  orderMatchesEmail: () => true,
  COLS: { address: 'col_address', tax_exempt_status: 'col_tax', tax_exempt_cert_file: 'col_cert' },
  STATUS_STAGES: [
    { key: 'placed' }, { key: 'in_production' }, { key: 'ready_to_ship' }, { key: 'shipped' }, { key: 'delivered' },
  ],
  TAX_EXEMPT_YES_LABEL: 'Yes',
  TAX_EXEMPT_NO_LABEL: 'No',
  PORTAL_DONE_LABEL: '✅',
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
  addressLine1: '123 Main St',
  addressCity: 'Springfield',
  addressState: 'IL',
  addressZip: '62704',
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

  // 2026-09-23: 'Yes, this is correct' on an order with no address on file
  // produced a submissions-board row with every ship-to column blank.
  it('rejects a confirmed ship-to address that has no street/city behind it', async () => {
    const data = { ...VALID_DELIVERY_DATA, addressLine1: '', addressCity: '', formattedAddress: '' };
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'delivery', data } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/No, I need to update it/);
    expect(mockCreateDeliverySubmissionItem).not.toHaveBeenCalled();
  });

  it('rejects Text Message as a preferred method with no mobile number', async () => {
    const data = { ...VALID_DELIVERY_DATA, primaryCommMethods: ['Email', 'Text Message'], primaryMobilePhone: '' };
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'delivery', data } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/mobile number/i);
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
    mockFindRecentDeliverySubmission.mockReset().mockResolvedValue(null);
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

  // Regression test for the cross-instance/cold-start backstop (PORTAL-018-
  // IDEMPOTENCY-FOLLOWUP, lib/monday.js's findRecentDeliverySubmission): the
  // in-memory guard above is module-scoped and would NEVER catch a retry
  // that lands on a different warm instance — that's exactly what this test
  // simulates, by never sending a first request at all (so the in-memory
  // Map has nothing recorded for this order) and instead having the
  // MONDAY-SIDE check itself report a pre-existing match, as if some other
  // instance had already recorded this exact submission moments ago.
  it('a same-content retry that the in-memory guard never saw (different instance) is still caught by the Monday-side backstop', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Dedup Order', stageIndex: 0 });
    mockFindRecentDeliverySubmission.mockResolvedValue({ id: 'existing-item-999', name: 'Dedup Order' });

    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockFindRecentDeliverySubmission).toHaveBeenCalledWith(orderId, expect.objectContaining({ pocName: VALID_DELIVERY_DATA.pocName }));
    expect(mockCreateDeliverySubmissionItem).not.toHaveBeenCalled();
  });

  it('alerts staff (does not fail silently) when the submissions-board row cannot be created', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Alert Order', stageIndex: 0 });
    mockCreateDeliverySubmissionItem.mockRejectedValueOnce(new Error('Monday down'));
    mockReportCriticalFailure.mockClear();

    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('delivery-submission-board', expect.stringContaining('Alert Order'), expect.objectContaining({ orderId }));
  });

  // The Monday-side check is a network call and can fail independently of
  // everything else in the request — it must fail OPEN (treat as "not a
  // duplicate") rather than block a legitimate submission just because the
  // idempotency backstop itself couldn't reach Monday.
  it('still creates the submission when the Monday-side duplicate check itself fails (fails open, does not block a real submission)', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Dedup Order', stageIndex: 0 });
    mockFindRecentDeliverySubmission.mockRejectedValue(new Error('Monday API unavailable'));

    const req = { method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockCreateDeliverySubmissionItem).toHaveBeenCalledTimes(1);
  });

  // The Monday-side check only needs to run when the (cheap, no-network)
  // in-memory guard hasn't already flagged this as a duplicate — no point
  // paying for a full board scan when the common same-instance-retry case
  // is already resolved for free. The FIRST submission for a never-before-
  // seen order still triggers it (the in-memory guard has nothing recorded
  // yet, so it can't be the one to short-circuit); it's the immediate
  // in-instance RETRY that should skip the network call entirely.
  it('does not call the Monday-side check on an immediate in-instance retry, once the in-memory guard already caught it', async () => {
    const orderId = nextOrderId();
    mockGetOrderById.mockResolvedValue({ id: orderId, name: 'Dedup Order', stageIndex: 0 });

    await handler({ method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } }, makeRes());
    expect(mockFindRecentDeliverySubmission).toHaveBeenCalledTimes(1);

    mockFindRecentDeliverySubmission.mockClear();
    await handler({ method: 'POST', headers: {}, body: { tab: 'delivery', data: VALID_DELIVERY_DATA } }, makeRes());
    expect(mockFindRecentDeliverySubmission).not.toHaveBeenCalled();
  });
});

describe('setup.js — AUDIT-2026-10-06 fixes', () => {
  const { validateTaxCertUpload } = handlerModule;
  const b64 = (n) => Buffer.alloc(n, 1).toString('base64');

  beforeEach(() => {
    mockGetOrderById.mockReset().mockResolvedValue({ id: 'real-order-123', name: 'Tax Order', stageIndex: 0, taxExemptStatus: '' });
    mockVerifyCustomerSession.mockReset().mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockSetStatusLabel.mockReset().mockResolvedValue(undefined);
    mockUploadFileToColumn.mockReset().mockResolvedValue(undefined);
  });

  it('409 ORDER_MISMATCH when the body names a different order — before the order is even loaded', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { orderId: 'other-order', tab: 'contact', data: { confirmed: true } } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ORDER_MISMATCH');
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });

  it('a matching body orderId is accepted', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { orderId: 'real-order-123', tab: 'contact', data: { confirmed: true } } }, res);
    expect(res.statusCode).toBe(200);
  });

  it('the removed legacy freight_ack tab is an unknown tab and never marks Delivery complete', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'freight_ack', data: { acknowledgedBy: 'Jane', acknowledgedAt: '2026-10-06' } } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Unknown tab/);
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
  });

  it('impersonated writes are attributed to the staff member in the Monday audit update', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123', impersonatedBy: 'staff@summitsensory.com' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'contact', data: { confirmed: true } } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('real-order-123', 'PORTAL: Contact Confirmed',
      expect.stringContaining('(done by staff staff@summitsensory.com while viewing as customer)'));
  });

  describe('validateTaxCertUpload', () => {
    it('accepts PDF/JPEG/PNG/HEIC by extension + type', () => {
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'cert.pdf', mimeType: 'application/pdf' }).mimeType).toBe('application/pdf');
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'cert.JPG', mimeType: 'image/jpeg' }).buffer.length).toBe(10);
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'scan.png', mimeType: 'image/png' }).error).toBeUndefined();
    });

    it('derives the type from the extension when the browser reports none (HEIC on Windows)', () => {
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'IMG_1.HEIC', mimeType: '' }).mimeType).toBe('image/heic');
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'x.pdf', mimeType: 'application/octet-stream' }).mimeType).toBe('application/pdf');
    });

    it('rejects other extensions or mismatching types', () => {
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'cert.html', mimeType: 'text/html' }).status).toBe(400);
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'cert.pdf', mimeType: 'text/html' }).status).toBe(400);
      expect(validateTaxCertUpload({ fileBase64: b64(10), fileName: 'noextension', mimeType: 'application/pdf' }).status).toBe(400);
    });

    it('requires the file data and name', () => {
      expect(validateTaxCertUpload({ fileName: 'cert.pdf' }).status).toBe(400);
      expect(validateTaxCertUpload({ fileBase64: b64(10) }).status).toBe(400);
    });

    it('413 over 3MB decoded', () => {
      expect(validateTaxCertUpload({ fileBase64: b64(3 * 1024 * 1024 + 1), fileName: 'big.pdf', mimeType: 'application/pdf' }).status).toBe(413);
      expect(validateTaxCertUpload({ fileBase64: b64(3 * 1024 * 1024), fileName: 'ok.pdf', mimeType: 'application/pdf' }).error).toBeUndefined();
    });
  });

  it('tax_exemption "Yes" with an invalid file never uploads or flips the status', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'tax_exemption', data: { taxExempt: true, fileBase64: b64(10), fileName: 'evil.exe', mimeType: 'application/x-msdownload' } } }, res);
    expect(res.statusCode).toBe(400);
    expect(mockUploadFileToColumn).not.toHaveBeenCalled();
    expect(mockSetStatusLabel).not.toHaveBeenCalled();
  });

  it('tax_exemption "No" never overwrites a staff-set "Yes"', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', name: 'Tax Order', taxExemptStatus: 'Yes' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'tax_exemption', data: { taxExempt: false } } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('TAX_STATUS_LOCKED');
    expect(mockSetStatusLabel).not.toHaveBeenCalled();
  });

  it('tax_exemption "No" is recorded while the status is blank', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'tax_exemption', data: { taxExempt: false } } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockSetStatusLabel).toHaveBeenCalledWith('real-order-123', 'taxExemptStatus', 'No');
  });

  it('tax_exemption "Yes" uploads but leaves any other staff-set label alone', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', name: 'Tax Order', taxExemptStatus: 'Verified' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'tax_exemption', data: { taxExempt: true, fileBase64: b64(10), fileName: 'cert.pdf', mimeType: 'application/pdf' } } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockUploadFileToColumn).toHaveBeenCalledTimes(1);
    expect(mockSetStatusLabel).not.toHaveBeenCalled();
  });

  it('tax_exemption "Yes" over blank/"No" uploads and sets "Yes"', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'real-order-123', name: 'Tax Order', taxExemptStatus: 'No' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { tab: 'tax_exemption', data: { taxExempt: true, fileBase64: b64(10), fileName: 'cert.pdf', mimeType: 'application/pdf' } } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockSetStatusLabel).toHaveBeenCalledWith('real-order-123', 'taxExemptStatus', 'Yes');
  });
});
