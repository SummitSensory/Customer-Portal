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
// AUDIT-2026-10-06: orderMatchesEmail is the REAL implementation (pure, no
// I/O) — the ownership check must behave exactly like getOrdersByEmail().
vi.mock('./monday', async () => {
  const actual = await vi.importActual('./monday');
  return {
    getOrderById: (...args) => mockGetOrderById(...args),
    orderMatchesEmail: actual.orderMatchesEmail,
  };
});

const mockAllowRequest = vi.fn();
vi.mock('./rateLimit', () => ({
  allowRequest: (...args) => mockAllowRequest(...args),
}));

const {
  requireCustomerSession, loadSessionOrder, enforceRateLimit,
  rejectOrderMismatch, staffAttribution, sessionActorLabel,
} = await import('./apiAuth');

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
    expect(session).toEqual({ email: 'a@b.com', orderId: 'order-1', impersonatedBy: null });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('exposes impersonatedBy for a staff "view as customer" session (AUDIT-2026-10-06)', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'order-1', impersonatedBy: 'staff@summitsensory.com' });
    const session = await requireCustomerSession({ headers: { cookie: 'summit_customer_session=t' } }, makeRes());
    expect(session.impersonatedBy).toBe('staff@summitsensory.com');
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
    mockGetOrderById.mockResolvedValue({ id: 'order-1', name: 'Real Order', customerEmail: 'a@b.com' });
    const res = makeRes();
    const order = await loadSessionOrder({ email: 'a@b.com', orderId: 'order-1' }, res);
    expect(order).toEqual({ id: 'order-1', name: 'Real Order', customerEmail: 'a@b.com' });
  });

  // AUDIT-2026-10-06 — ownership re-check.
  it('matches the order email case-insensitively and ignoring surrounding whitespace (same rule as getOrdersByEmail)', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'order-1', customerEmail: '  Jane.Doe@School.ORG ' });
    const res = makeRes();
    const order = await loadSessionOrder({ email: 'jane.doe@school.org', orderId: 'order-1' }, res);
    expect(order).not.toBeNull();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('writes a 401 ORDER_NOT_OWNED when the order now belongs to a different email', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'order-1', customerEmail: 'someone-else@school.org' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = makeRes();
    const order = await loadSessionOrder({ email: 'a@b.com', orderId: 'order-1' }, res);
    expect(order).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('ORDER_NOT_OWNED');
    warnSpy.mockRestore();
  });

  it('writes a 401 when the order has no customer email on file at all', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'order-1', customerEmail: '' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = makeRes();
    expect(await loadSessionOrder({ email: 'a@b.com', orderId: 'order-1' }, res)).toBeNull();
    expect(res.statusCode).toBe(401);
    warnSpy.mockRestore();
  });

  it('lets an impersonation session through — it carries the order\'s own customer email', async () => {
    mockGetOrderById.mockResolvedValue({ id: 'order-1', customerEmail: 'a@b.com' });
    const res = makeRes();
    const order = await loadSessionOrder({ email: 'a@b.com', orderId: 'order-1', impersonatedBy: 'staff@summitsensory.com' }, res);
    expect(order).not.toBeNull();
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

describe('rejectOrderMismatch (AUDIT-2026-10-06)', () => {
  const session = { email: 'a@b.com', orderId: '12345' };

  it('allows a request with no orderId in the body (older open tabs)', () => {
    const res = makeRes();
    expect(rejectOrderMismatch({ body: {} }, session, res)).toBe(true);
    expect(rejectOrderMismatch({}, session, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows a matching orderId, string or number', () => {
    const res = makeRes();
    expect(rejectOrderMismatch({ body: { orderId: '12345' } }, session, res)).toBe(true);
    expect(rejectOrderMismatch({ body: { orderId: 12345 } }, session, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('writes a 409 ORDER_MISMATCH with the agreed message when the orderId differs', () => {
    const res = makeRes();
    expect(rejectOrderMismatch({ body: { orderId: '99999' } }, session, res)).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'This order is no longer the active order in this browser. Please reload.',
      code: 'ORDER_MISMATCH',
    });
  });

  it('rejects any explicit orderId when the session has no bound order yet', () => {
    const res = makeRes();
    expect(rejectOrderMismatch({ body: { orderId: '12345' } }, { email: 'a@b.com' }, res)).toBe(false);
    expect(res.statusCode).toBe(409);
  });
});

describe('staffAttribution / sessionActorLabel (AUDIT-2026-10-06)', () => {
  it('is empty / just the email for a genuine customer session', () => {
    expect(staffAttribution({ email: 'a@b.com' })).toBe('');
    expect(sessionActorLabel({ email: 'a@b.com' })).toBe('a@b.com');
  });

  it('names the staff member for an impersonation session', () => {
    const s = { email: 'a@b.com', impersonatedBy: 'staff@summitsensory.com' };
    expect(staffAttribution(s)).toBe(' (done by staff staff@summitsensory.com while viewing as customer)');
    expect(sessionActorLabel(s)).toBe('a@b.com (done by staff staff@summitsensory.com while viewing as customer)');
  });
});
