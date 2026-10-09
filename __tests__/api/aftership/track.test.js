import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  resolveDeliveryContacts: () => ({}),
}));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

vi.mock('next-auth/next', () => ({ getServerSession: async () => null }));
vi.mock('../../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const mockTrackShipment = vi.fn();
vi.mock('../../../lib/aftership', () => ({
  trackShipment: (...args) => mockTrackShipment(...args),
  buildTrackingTitle: () => 'title',
  buildCustomFields: () => ({}),
}));

const { default: handler } = await import('../../../pages/api/aftership/track.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const req = (query) => ({ method: 'GET', headers: {}, query });

describe('GET /api/aftership/track — customer path', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockVerifyCustomerSession.mockReset().mockResolvedValue({ email: 'a@b.com', orderId: '1' });
    mockTrackShipment.mockReset().mockResolvedValue({ tag: 'InTransit' });
  });

  it('returns a clean 500 (not a crash) when loading the order fails', async () => {
    mockGetOrderById.mockRejectedValue(new Error('Monday timeout'));
    const res = makeRes();
    await handler(req({ slug: 'fedex', number: '123' }), res);
    expect(res.statusCode).toBe(500);
    expect(mockTrackShipment).not.toHaveBeenCalled();
  });

  it('returns 400 when the session has no order bound', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com' });
    const res = makeRes();
    await handler(req({ slug: 'fedex', number: '123' }), res);
    expect(res.statusCode).toBe(400);
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });

  it("uses the order's own carrier slug, not the one in the request", async () => {
    mockGetOrderById.mockResolvedValue({ id: '1', name: 'O', frameTrackingId: '123', frameCarrierSlug: 'estes' });
    const res = makeRes();
    await handler(req({ slug: 'fedex', number: '123' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockTrackShipment).toHaveBeenCalledWith('estes', '123', expect.anything());
  });

  it('still rejects a tracking number that is not on the order', async () => {
    mockGetOrderById.mockResolvedValue({ id: '1', name: 'O', frameTrackingId: '123', frameCarrierSlug: 'estes' });
    const res = makeRes();
    await handler(req({ slug: 'fedex', number: '999' }), res);
    expect(res.statusCode).toBe(403);
  });
});
