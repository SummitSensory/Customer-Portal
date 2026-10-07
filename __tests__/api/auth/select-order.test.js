import { describe, it, expect, vi, beforeEach } from 'vitest';

// PORTAL-059: select-order.js used to unconditionally re-sign the session
// with signCustomerSession() (7-day, no impersonatedBy) no matter what kind
// of session the CALLER had — silently upgrading a staff "view/act as
// customer" impersonation session (signImpersonationSession(), 2-hour,
// tagged with impersonatedBy) into a normal 7-day customer session with the
// impersonatedBy accountability tag dropped, the moment a staff member
// picked a different order for the customer they were impersonating. These
// tests pin the fix: which signing function gets called, and with what
// arguments/expiry, depends on whether the INCOMING session already carried
// impersonatedBy.

const mockVerifyCustomerSession = vi.fn();
const mockSignCustomerSession = vi.fn();
const mockSignImpersonationSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  signCustomerSession: (...args) => mockSignCustomerSession(...args),
  signImpersonationSession: (...args) => mockSignImpersonationSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
  cookieOptions: (maxAge) => ({
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge,
  }),
}));

const mockGetOrdersByEmail = vi.fn();
const mockGetOrderById = vi.fn();
vi.mock('../../../lib/monday', async () => {
  const actual = await vi.importActual('../../../lib/monday');
  return {
    getOrdersByEmail: (...args) => mockGetOrdersByEmail(...args),
    getOrderById: (...args) => mockGetOrderById(...args),
    // AUDIT-2026-10-06: the real serializer, so the tests below can pin
    // that admin-only fields never reach the customer.
    toCustomerOrder: actual.toCustomerOrder,
  };
});

const { default: handler } = await import('../../../pages/api/auth/select-order.js');

function makeReq({ cookie = 'summit_customer_session=token123', body = {} } = {}) {
  return { method: 'POST', headers: { cookie }, body };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.headers = {};
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn((name, value) => { res.headers[name] = value; });
  return res;
}

const ORDERS = [
  { id: 'order-1', name: 'Order One' },
  { id: 'order-2', name: 'Order Two' },
];

describe('select-order.js — session re-sign preserves session kind (PORTAL-059)', () => {
  beforeEach(() => {
    mockVerifyCustomerSession.mockReset();
    mockSignCustomerSession.mockReset().mockResolvedValue('signed.customer.token');
    mockSignImpersonationSession.mockReset().mockResolvedValue('signed.impersonation.token');
    mockGetOrdersByEmail.mockReset().mockResolvedValue(ORDERS);
    mockGetOrderById.mockReset().mockImplementation(async (id) => ({
      ...ORDERS.find((o) => o.id === id),
      contactName: 'Mirror Contact',
      rawColumns: { secret: { text: 'internal' } },
      files: [{ id: 'f1' }],
    }));
  });

  it('rejects a non-POST method', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects an unauthenticated request', async () => {
    mockVerifyCustomerSession.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('a normal customer session re-signs with signCustomerSession() at the normal 7-day expiry', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'order-2', role: 'customer' });
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res);

    expect(res.statusCode).toBe(200);
    expect(mockSignCustomerSession).toHaveBeenCalledWith('a@b.com', 'order-1', 'Order One');
    expect(mockSignImpersonationSession).not.toHaveBeenCalled();
    expect(res.headers['Set-Cookie']).toContain('Max-Age=604800'); // 60*60*24*7
  });

  it('a staff impersonation session re-signs with signImpersonationSession(), preserving impersonatedBy and the 2-hour expiry', async () => {
    mockVerifyCustomerSession.mockResolvedValue({
      email: 'a@b.com',
      orderId: 'order-2',
      role: 'customer',
      impersonatedBy: 'staffer@summitsensory.com',
    });
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res);

    expect(res.statusCode).toBe(200);
    expect(mockSignImpersonationSession).toHaveBeenCalledWith(
      'a@b.com',
      'order-1',
      'Order One',
      'staffer@summitsensory.com'
    );
    expect(mockSignCustomerSession).not.toHaveBeenCalled();
    expect(res.headers['Set-Cookie']).toContain('Max-Age=7200'); // 60*60*2
  });

  // AUDIT-2026-10-06 — response contract the portal relies on.
  it('returns the FULL order (getOrderById, mirror columns) serialized for the customer — no rawColumns/files', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', role: 'customer' });
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockGetOrderById).toHaveBeenCalledWith('order-1');
    expect(res.body.ok).toBe(true);
    expect(res.body.order).toEqual({ id: 'order-1', name: 'Order One', contactName: 'Mirror Contact' });
  });

  it('falls back to the serialized list row when the full read throws or returns null', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', role: 'customer' });
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-1', name: 'Order One', rawColumns: {}, files: [] }]);
    mockGetOrderById.mockRejectedValueOnce(new Error('Monday down'));
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.order).toEqual({ id: 'order-1', name: 'Order One' });

    mockGetOrderById.mockResolvedValueOnce(null);
    const res2 = makeRes();
    await handler(makeReq({ body: { orderId: 'order-1' } }), res2);
    expect(res2.body.order).toEqual({ id: 'order-1', name: 'Order One' });
  });

  it('rejects an order that does not belong to the customer, for both session kinds', async () => {
    mockVerifyCustomerSession.mockResolvedValue({
      email: 'a@b.com',
      orderId: 'order-2',
      role: 'customer',
      impersonatedBy: 'staffer@summitsensory.com',
    });
    const res = makeRes();
    await handler(makeReq({ body: { orderId: 'not-mine' } }), res);
    expect(res.statusCode).toBe(403);
    expect(mockSignCustomerSession).not.toHaveBeenCalled();
    expect(mockSignImpersonationSession).not.toHaveBeenCalled();
  });
});
