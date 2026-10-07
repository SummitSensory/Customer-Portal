import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDIT-2026-10-06 — customer GET /api/monday/order serializes every order
// through toCustomerOrder (no rawColumns/files) and re-checks ownership;
// staff GET /api/monday/orders?id= returns one full order.

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...a) => mockVerifyCustomerSession(...a),
  SESSION_COOKIE: 'summit_customer_session',
}));

const mockGetServerSession = vi.fn();
vi.mock('next-auth/next', () => ({ getServerSession: (...a) => mockGetServerSession(...a) }));
vi.mock('../../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../../lib/email', () => ({ notifyCustomerStatusChange: vi.fn(), isCustomerFacingStatus: () => false }));

const mockGetOrderById = vi.fn();
const mockGetOrdersByEmail = vi.fn();
const mockGetAllOrders = vi.fn();
vi.mock('../../../lib/monday', async () => {
  const actual = await vi.importActual('../../../lib/monday');
  return {
    getOrderById: (...a) => mockGetOrderById(...a),
    getOrdersByEmail: (...a) => mockGetOrdersByEmail(...a),
    getAllOrders: (...a) => mockGetAllOrders(...a),
    updateOrderStatus: vi.fn(), updateTrackingNumber: vi.fn(), updateBalance: vi.fn(), sendCustomerNotificationOnce: vi.fn(),
    orderMatchesEmail: actual.orderMatchesEmail,
    toCustomerOrder: actual.toCustomerOrder,
  };
});

const { default: orderHandler } = await import('../../../pages/api/monday/order.js');
const { default: ordersHandler } = await import('../../../pages/api/monday/orders.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const FULL = { id: '1', name: 'Order', customerEmail: 'a@b.com', contactName: 'Jane', rawColumns: { x: {} }, files: [{ id: 'f' }] };

beforeEach(() => {
  mockVerifyCustomerSession.mockReset();
  mockGetServerSession.mockReset().mockResolvedValue(null);
  mockGetOrderById.mockReset().mockResolvedValue(FULL);
  mockGetOrdersByEmail.mockReset().mockResolvedValue([FULL, { ...FULL, id: '2' }]);
  mockGetAllOrders.mockReset().mockResolvedValue([FULL]);
});

describe('GET /api/monday/order (customer)', () => {
  it('bound order: serialized, no rawColumns/files', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '1' });
    const res = makeRes();
    await orderHandler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.order).toEqual({ id: '1', name: 'Order', customerEmail: 'a@b.com', contactName: 'Jane' });
  });

  it('?all=1 list: every order serialized', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '1' });
    const res = makeRes();
    await orderHandler({ method: 'GET', headers: {}, query: { all: '1' } }, res);
    expect(res.body.orders).toHaveLength(2);
    for (const o of res.body.orders) {
      expect(o).not.toHaveProperty('rawColumns');
      expect(o).not.toHaveProperty('files');
    }
  });

  it('401 ORDER_NOT_OWNED when the bound order now has a different customer email', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: '1' });
    mockGetOrderById.mockResolvedValue({ ...FULL, customerEmail: 'new@b.com' });
    const res = makeRes();
    await orderHandler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('ORDER_NOT_OWNED');
  });
});

describe('GET /api/monday/orders?id= (staff)', () => {
  it('returns the full order from getOrderById', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'kyle@summitsensory.com' } });
    const res = makeRes();
    await ordersHandler({ method: 'GET', headers: {}, query: { id: '1' } }, res);
    expect(res.statusCode).toBe(200);
    expect(mockGetOrderById).toHaveBeenCalledWith('1');
    expect(res.body).toEqual({ order: FULL });
    expect(mockGetAllOrders).not.toHaveBeenCalled();
  });

  it('404 when not found; list behaviour unchanged without id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'kyle@summitsensory.com' } });
    mockGetOrderById.mockResolvedValue(null);
    const res = makeRes();
    await ordersHandler({ method: 'GET', headers: {}, query: { id: '404' } }, res);
    expect(res.statusCode).toBe(404);

    const res2 = makeRes();
    await ordersHandler({ method: 'GET', headers: {}, query: {} }, res2);
    expect(res2.body).toEqual({ orders: [FULL] });
  });

  it('401 without a staff session', async () => {
    const res = makeRes();
    await ordersHandler({ method: 'GET', headers: {}, query: { id: '1' } }, res);
    expect(res.statusCode).toBe(401);
  });
});
