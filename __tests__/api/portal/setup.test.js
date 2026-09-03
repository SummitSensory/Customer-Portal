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
