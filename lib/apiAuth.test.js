import { describe, it, expect, vi, beforeEach } from 'vitest';

// Extracted 2026-09-03 after independent code review flagged pages/api/
// portal/color-selection.js and pages/api/portal/setup.js as separately
// reimplementing the identical session/order-load/rate-limit boilerplate.
// These are the direct unit tests for the shared primitives themselves;
// __tests__/api/portal/setup.test.js and color-selection.test.js cover the
// two real callers end to end.

const mockVerifyCustomerSession = vi.fn();
vi.mock('./auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

const mockGetOrderById = vi.fn();
vi.mock('./monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
}));

const mockAllowRequest = vi.fn();
vi.mock('./rateLimit', () => ({
  allowRequest: (...args) => mockAllowRequest(...args),
}));

const { requireCustomerSession, loadSessionOrder, enforceRateLimit } = await import('./apiAuth');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

describe('requireCustomerSession', () => {
  beforeEach(() => mockVerifyCustomerSession.mockReset());

  it('returns the session when the cookie verifies', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'order-1' });
    const req = { headers: { cookie: 'summit_customer_session=real-token' } };
    const res = makeRes();
    const session = await requireCustomerSession(req, res);
    expect(session).toEqual({ email: 'a@b.com', orderId: 'order-1' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('writes a 401 and returns null when the cookie is missing/invalid', async () => {
    mockVerifyCustomerSession.mockResolvedValue(null);
    const req = { headers: {} };
    const res = makeRes();
    const session = await requireCustomerSession(req, res);
    expect(session).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

describe('loadSessionOrder', () => {
  beforeEach(() => mockGetOrderById.mockReset());

  it('returns the order for a valid, existing orderId', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Real Order' });
    const res = makeRes();
    const order = await loadSessionOrder({ orderId: 'order-1' }, res);
    expect(order).toEqual({ id: 'order-1', name: 'Real Order' });
  });

  it('writes a 400 and never calls getOrderById for a session with no orderId', async () => {
    const res = makeRes();
    const order = await loadSessionOrder({ email: 'a@b.com', orderId: null }, res);
    expect(order).toBeNull();
    expect(res.statusCode).toBe(400);
    expect(mockGetOrderById).not.toHaveBeenCalled();
  });

  it('writes a 404 when the order genuinely does not exist', async () => {
    mockGetOrderById.mockResolvedValue(null);
    const res = makeRes();
    const order = await loadSessionOrder({ orderId: 'order-1' }, res);
    expect(order).toBeNull();
    expect(res.statusCode).toBe(404);
  });

  it('writes a 500 and logs (with the given prefix) when the load throws', async () => {
    mockGetOrderById.mockRejectedValueOnce(new Error('Monday API down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    const order = await loadSessionOrder({ orderId: 'order-1' }, res, { logPrefix: 'test-route' });
    expect(order).toBeNull();
    expect(res.statusCode).toBe(500);
    expect(consoleSpy).toHaveBeenCalledWith('test-route: failed to load order:', 'Monday API down');
    consoleSpy.mockRestore();
  });

  it('does not throw or log if logPrefix is omitted on a load failure', async () => {
    mockGetOrderById.mockRejectedValueOnce(new Error('Monday API down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await loadSessionOrder({ orderId: 'order-1' }, res);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('enforceRateLimit', () => {
  beforeEach(() => mockAllowRequest.mockReset());

  it('returns true and writes nothing when the request is allowed', () => {
    mockAllowRequest.mockReturnValue(true);
    const res = makeRes();
    expect(enforceRateLimit(res, 'some-key', { maxRequests: 5, windowMs: 1000 })).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('writes a 429 and returns false when the request is rate-limited', () => {
    mockAllowRequest.mockReturnValue(false);
    const res = makeRes();
    expect(enforceRateLimit(res, 'some-key', { maxRequests: 5, windowMs: 1000 })).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it('passes the exact key and options through to allowRequest', () => {
    mockAllowRequest.mockReturnValue(true);
    const res = makeRes();
    enforceRateLimit(res, 'color-selection:a@b.com', { maxRequests: 100, windowMs: 60_000 });
    expect(mockAllowRequest).toHaveBeenCalledWith('color-selection:a@b.com', { maxRequests: 100, windowMs: 60_000 });
  });
});
