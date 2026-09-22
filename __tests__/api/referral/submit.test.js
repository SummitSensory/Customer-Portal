import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockCreateReferralItem = vi.fn();
const mockFindRecentReferral = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  createReferralItem: (...args) => mockCreateReferralItem(...args),
  findRecentReferral: (...args) => mockFindRecentReferral(...args),
}));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

vi.mock('../../../lib/rateLimit', () => ({
  allowRequest: () => true,
}));

const mockNotifyTeamNewReferral = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  notifyTeamNewReferral: (...args) => mockNotifyTeamNewReferral(...args),
}));

const { default: handler } = await import('../../../pages/api/referral/submit.js');

function makeReq(body) {
  return { method: 'POST', headers: { cookie: 'summit_customer_session=tok' }, body };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

// PORTAL-063: findRecentReferral() is a real, but non-atomic, Monday-side
// read-then-create dedupe (documented in lib/monday.js) — a true
// double-click can have both requests read "no recent referral" before
// either one's createReferralItem() write lands, producing two duplicate
// Referrals board rows and two duplicate staff notification emails. The
// fix adds an in-process, in-memory lock keyed on (orderId, friendEmail)
// that rejects a second concurrent request for the same key outright,
// closing the single-instance case findRecentReferral() alone could not.
describe('POST /api/referral/submit — PORTAL-063 duplicate-submission lock', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockCreateReferralItem.mockReset();
    mockFindRecentReferral.mockReset();
    mockNotifyTeamNewReferral.mockReset().mockResolvedValue(undefined);
    mockVerifyCustomerSession.mockReset();
  });

  function validBody() {
    return { friendName: 'Alex Friend', friendEmail: 'alex@example.com', friendPhone: '', message: '' };
  }

  it('a genuine double-click (two concurrent requests, same order + friend email) creates only ONE referral', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'customer@example.com', orderId: 'order-1' });
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    mockFindRecentReferral.mockResolvedValue(null);
    mockCreateReferralItem.mockResolvedValue('new-referral-item-id');

    const res1 = makeRes();
    const res2 = makeRes();
    // Fired back-to-back with no await between them — both requests race
    // through the exact same async structure (verifyCustomerSession ->
    // lock check -> getOrderById -> findRecentReferral -> create), driven
    // by the same already-resolved mocks, so JS's deterministic FIFO
    // microtask ordering means the first call's lock-check always wins.
    const p1 = handler(makeReq(validBody()), res1);
    const p2 = handler(makeReq(validBody()), res2);
    await Promise.all([p1, p2]);

    expect(mockCreateReferralItem).toHaveBeenCalledTimes(1);
    expect(mockNotifyTeamNewReferral).toHaveBeenCalledTimes(1);
    // Both requests still get a 200 — the rejected one is reported as a
    // duplicate, not an error, matching findRecentReferral()'s own
    // duplicate-handling response shape.
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect([res1.body, res2.body]).toEqual(expect.arrayContaining([{ ok: true, duplicate: true }]));
  });

  it('releases the lock after completion, so a genuinely sequential second submission for the same pair is NOT blocked', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'customer@example.com', orderId: 'order-1' });
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    mockFindRecentReferral.mockResolvedValue(null);
    mockCreateReferralItem.mockResolvedValue('item-1');

    const res1 = makeRes();
    await handler(makeReq(validBody()), res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body).toEqual({ ok: true });

    // A second, later, genuinely sequential request for the same pair —
    // findRecentReferral (Monday's own dedupe) is what should catch this
    // one, not the now-released in-process lock.
    mockFindRecentReferral.mockResolvedValue({ id: 'existing' });
    const res2 = makeRes();
    await handler(makeReq(validBody()), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ ok: true, duplicate: true });
    expect(mockCreateReferralItem).toHaveBeenCalledTimes(1);
  });

  it('does not lock across different orders or different friend emails', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'customer@example.com', orderId: 'order-1' });
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    mockFindRecentReferral.mockResolvedValue(null);
    mockCreateReferralItem.mockResolvedValue('item-a');

    const res1 = makeRes();
    const res2 = makeRes();
    // Different friend email — must NOT be rejected by the first request's lock,
    // even fired concurrently with no await between them.
    const p1 = handler(makeReq(validBody()), res1);
    const p2 = handler(makeReq({ ...validBody(), friendEmail: 'someone-else@example.com' }), res2);
    await Promise.all([p1, p2]);

    expect(mockCreateReferralItem).toHaveBeenCalledTimes(2);
    expect(res1.body).toEqual({ ok: true });
    expect(res2.body).toEqual({ ok: true });
  });

  it('releases the lock even when createReferralItem fails, so a retry after a real failure is not blocked', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'customer@example.com', orderId: 'order-1' });
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Order 1' });
    mockFindRecentReferral.mockResolvedValue(null);
    mockCreateReferralItem.mockRejectedValueOnce(new Error('Monday API error'));

    const res1 = makeRes();
    await handler(makeReq(validBody()), res1);
    expect(res1.statusCode).toBe(500);

    mockCreateReferralItem.mockResolvedValueOnce('item-retry');
    const res2 = makeRes();
    await handler(makeReq(validBody()), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ ok: true });
  });
});
