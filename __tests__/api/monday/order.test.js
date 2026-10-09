import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...a) => mockVerifyCustomerSession(...a),
  SESSION_COOKIE: 'summit_customer_session',
  clearCookieOptions: () => ({ path: '/', maxAge: 0 }),
  signFormOrderToken: async (id) => `form-token-${id}`,
}));

const mockGetOrderById = vi.fn();
const mockGetOrdersByEmail = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...a) => mockGetOrderById(...a),
  getOrdersByEmail: (...a) => mockGetOrdersByEmail(...a),
}));

const { default: handler } = await import('../../../pages/api/monday/order.js');

function makeRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
  return res;
}
const req = (query = {}) => ({ method: 'GET', query, headers: { cookie: 'summit_customer_session=x' } });

describe('/api/monday/order', () => {
  beforeEach(() => {
    mockVerifyCustomerSession.mockReset();
    mockGetOrderById.mockReset();
    mockGetOrdersByEmail.mockReset();
  });

  it('never sends rawColumns or internal fields to customers', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'c@school.org', orderId: 'o1' });
    mockGetOrderById.mockResolvedValue({ id: 'o1', customerEmail: 'c@school.org', rawColumns: { cost: { text: '$9' } }, messageStatus: 'Needs Reply' });
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.order.id).toBe('o1');
    expect(res.body.order.rawColumns).toBeUndefined();
    expect(res.body.order.messageStatus).toBeUndefined();
  });

  it('includes a signed Jotform order token for the bound order', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'c@school.org', orderId: 'o1' });
    mockGetOrderById.mockResolvedValue({ id: 'o1', customerEmail: 'c@school.org' });
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.order.formOrderToken).toBe('form-token-o1');
  });

  it('revokes a session whose email no longer matches the order', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'old@school.org', orderId: 'o1' });
    mockGetOrderById.mockResolvedValue({ id: 'o1', customerEmail: 'new@school.org' });
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['Set-Cookie'])).toMatch(/summit_customer_session=;/);
  });

  it('matches email case-insensitively and exempts impersonation', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'C@School.org', orderId: 'o1' });
    mockGetOrderById.mockResolvedValue({ id: 'o1', customerEmail: ' c@school.org' });
    let res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);

    mockVerifyCustomerSession.mockResolvedValue({ email: 'old@school.org', orderId: 'o1', impersonatedBy: 'staff@summitsensory.com' });
    mockGetOrderById.mockResolvedValue({ id: 'o1', customerEmail: 'new@school.org' });
    res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
  });

  it('a session with no bound order and one order gets the FULL order', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'c@school.org' });
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'o1', name: 'List copy', rawColumns: {} }]);
    mockGetOrderById.mockResolvedValue({ id: 'o1', name: 'Full', colorGates: {}, rawColumns: {} });
    const res = makeRes();
    await handler(req(), res);
    expect(mockGetOrderById).toHaveBeenCalledWith('o1');
    expect(res.body.order).toMatchObject({ name: 'Full' });
    expect(res.body.order.rawColumns).toBeUndefined();
  });

  it('?all=1 lists strip internal fields too', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'c@school.org', orderId: 'o1' });
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'o1', rawColumns: {} }, { id: 'o2', rawColumns: {} }]);
    const res = makeRes();
    await handler(req({ all: '1' }), res);
    expect(res.body.orders.every(o => o.rawColumns === undefined)).toBe(true);
  });
});
