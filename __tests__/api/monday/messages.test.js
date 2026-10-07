import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDIT-2026-10-06 — pages/api/monday/messages.js:
//   - customer GET returns only the portal chat (toCustomerMessages), no
//     creator emails; staff GET unchanged;
//   - customer POST naming a different order → 409 ORDER_MISMATCH;
//   - a failure AFTER the message is posted never turns into a 500 (which
//     made the customer retry and post it twice);
//   - an impersonated post is attributed to the staff member.

const mockGetServerSession = vi.fn();
vi.mock('next-auth/next', () => ({ getServerSession: (...a) => mockGetServerSession(...a) }));
vi.mock('../../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...a) => mockVerifyCustomerSession(...a),
  SESSION_COOKIE: 'summit_customer_session',
}));

const mockGetOrderMessages = vi.fn();
const mockPostOrderMessage = vi.fn();
const mockPostTaggedUpdate = vi.fn();
const mockGetOrderById = vi.fn();
const mockSetStatusLabel = vi.fn();
const mockOrderIdBelongsToEmail = vi.fn();
vi.mock('../../../lib/monday', async () => {
  const actual = await vi.importActual('../../../lib/monday');
  return {
    getOrderMessages: (...a) => mockGetOrderMessages(...a),
    postOrderMessage: (...a) => mockPostOrderMessage(...a),
    postTaggedUpdate: (...a) => mockPostTaggedUpdate(...a),
    getOrderById: (...a) => mockGetOrderById(...a),
    setStatusLabel: (...a) => mockSetStatusLabel(...a),
    orderMatchesEmail: actual.orderMatchesEmail,
    orderIdBelongsToEmail: (...a) => mockOrderIdBelongsToEmail(...a),
    toCustomerMessages: actual.toCustomerMessages,
  };
});

const mockNotifyTeamNewMessage = vi.fn();
vi.mock('../../../lib/email', () => ({ notifyTeamNewMessage: (...a) => mockNotifyTeamNewMessage(...a) }));
vi.mock('../../../lib/replyNotify', () => ({ notifyPendingStaffReplies: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../lib/rateLimit', () => ({ allowRequest: () => true }));

const { default: handler } = await import('../../../pages/api/monday/messages.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const BRYAN = { id: 9, name: 'Bryan Shepherd', email: 'bryan@summitsensory.com' };
const UPDATES = [
  { id: 1, body: '[PORTAL][PORTAL:CUSTOMER]\nHello', created_at: 't1', creator: BRYAN, replies: [] },
  { id: 2, body: 'Internal: watch this one', created_at: 't2', creator: BRYAN, replies: [] },
  { id: 3, body: '[PORTAL: Staff Viewing As Customer]\nx', created_at: 't3', creator: BRYAN, replies: [] },
];
const ORDER = { id: '123', name: 'Test School - Adventure', customerEmail: 'a@b.com' };

beforeEach(() => {
  mockGetServerSession.mockReset().mockResolvedValue(null);
  mockVerifyCustomerSession.mockReset();
  mockGetOrderMessages.mockReset().mockResolvedValue(UPDATES);
  mockPostOrderMessage.mockReset().mockResolvedValue({ id: 50, body: '[PORTAL][PORTAL:CUSTOMER]\nhi', created_at: 't', creator: BRYAN });
  mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
  mockGetOrderById.mockReset().mockResolvedValue(ORDER);
  mockSetStatusLabel.mockReset().mockResolvedValue(undefined);
  mockOrderIdBelongsToEmail.mockReset().mockResolvedValue(true);
  mockNotifyTeamNewMessage.mockReset().mockResolvedValue(undefined);
});

describe('GET', () => {
  it('customer: only portal chat, no creator emails', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: { orderId: '123' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.messages.map((m) => m.id)).toEqual([1]);
    expect(JSON.stringify(res.body)).not.toContain('bryan@summitsensory.com');
  });

  // AUDIT-2026-10-06 (follow-up): same ownership re-check as loadSessionOrder.
  it('customer whose order now belongs to another email → 401 ORDER_NOT_OWNED, no messages', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    mockOrderIdBelongsToEmail.mockResolvedValue(false);
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: { orderId: '123' } }, res);
    expect(mockOrderIdBelongsToEmail).toHaveBeenCalledWith('123', 'a@b.com');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('ORDER_NOT_OWNED');
    expect(res.body.messages).toBeUndefined();
  });

  it('staff: the full, unfiltered history', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'kyle@summitsensory.com' } });
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: { orderId: '123' } }, res);
    expect(res.body.messages).toEqual(UPDATES);
    expect(mockOrderIdBelongsToEmail).not.toHaveBeenCalled();
  });
});

describe('POST', () => {
  it('customer naming a different order → 409 ORDER_MISMATCH, nothing posted', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { orderId: '999', body: 'hi' } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ORDER_MISMATCH');
    expect(mockPostOrderMessage).not.toHaveBeenCalled();
  });

  it('customer whose order now belongs to another email → 401, nothing posted', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    mockGetOrderById.mockResolvedValue({ ...ORDER, customerEmail: 'new-owner@b.com' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { orderId: '123', body: 'hi' } }, res);
    expect(res.statusCode).toBe(401);
    expect(mockPostOrderMessage).not.toHaveBeenCalled();
  });

  it('a follow-up failure after the message is posted still answers 201 (no retry → no duplicate)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    mockNotifyTeamNewMessage.mockImplementation(() => { throw new Error('sync throw'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { orderId: '123', body: 'hi' } }, res);
    errSpy.mockRestore();
    expect(res.statusCode).toBe(201);
    expect(mockPostOrderMessage).toHaveBeenCalledTimes(1);
    // Only the pre-write order read — nothing re-reads the order after posting.
    expect(mockGetOrderById).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.body)).not.toContain('bryan@summitsensory.com');
  });

  it('a failure loading the order BEFORE posting is a clean 500 with nothing posted', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer' });
    mockGetOrderById.mockRejectedValue(new Error('Monday down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { orderId: '123', body: 'hi' } }, res);
    errSpy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(mockPostOrderMessage).not.toHaveBeenCalled();
  });

  it('impersonated post: attributed to the staff member in the team email and an audit update', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '123', role: 'customer', impersonatedBy: 'staff@summitsensory.com' });
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { orderId: '123', body: 'hi' } }, res);
    expect(res.statusCode).toBe(201);
    expect(mockNotifyTeamNewMessage).toHaveBeenCalledWith(ORDER.name, expect.stringContaining('done by staff staff@summitsensory.com'), 'hi');
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('123', 'PORTAL: Staff Action While Viewing As Customer', expect.stringContaining('staff@summitsensory.com'));
  });
});
