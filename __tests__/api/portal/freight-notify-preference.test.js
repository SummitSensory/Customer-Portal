import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetFreightNotifyPreference = vi.fn().mockResolvedValue(undefined);
const mockOrderIdBelongsToEmail = vi.fn().mockResolvedValue(true);
vi.mock('../../../lib/monday', () => ({
  setFreightNotifyPreference: (...args) => mockSetFreightNotifyPreference(...args),
  orderIdBelongsToEmail: (...args) => mockOrderIdBelongsToEmail(...args),
}));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...args) => mockVerifyCustomerSession(...args),
  SESSION_COOKIE: 'summit_customer_session',
}));

const mockAllowRequest = vi.fn().mockReturnValue(true);
vi.mock('../../../lib/rateLimit', () => ({
  allowRequest: (...args) => mockAllowRequest(...args),
}));

const { default: handler } = await import('../../../pages/api/portal/freight-notify-preference.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

describe('POST /api/portal/freight-notify-preference', () => {
  beforeEach(() => {
    mockSetFreightNotifyPreference.mockReset().mockResolvedValue(undefined);
    mockVerifyCustomerSession.mockReset();
    mockAllowRequest.mockReset().mockReturnValue(true);
    mockOrderIdBelongsToEmail.mockReset().mockResolvedValue(true);
  });

  it('rejects a non-POST method', async () => {
    const req = { method: 'GET', headers: {}, body: {} };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    mockVerifyCustomerSession.mockResolvedValue(null);
    const req = { method: 'POST', headers: {}, body: { enabled: true } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalled();
  });

  // PORTAL-XXX: this route previously had no rate limit at all, unlike every
  // sibling customer-write route under pages/api/portal/. This is the
  // regression test for the fix — proves the route now actually calls
  // through enforceRateLimit (which calls allowRequest under the hood) and
  // honors a 429 by refusing to touch Monday at all.
  it('rate-limits repeated requests from the same session, matching every sibling portal write route', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'order-1' });
    mockAllowRequest.mockReturnValue(false);

    const req = { method: 'POST', headers: {}, body: { enabled: true } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalled();
    // Keyed per-session, not globally, so one customer looping this
    // endpoint can't rate-limit every other customer.
    expect(mockAllowRequest).toHaveBeenCalledWith(
      'freight-notify-preference:a@b.com',
      expect.objectContaining({ maxRequests: 20, windowMs: 60_000 })
    );
  });

  it('rejects a non-boolean enabled value', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'order-1' });
    const req = { method: 'POST', headers: {}, body: { enabled: 'yes' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalled();
  });

  it('persists the preference against the session-bound order, not a client-supplied one', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    const req = {
      method: 'POST',
      headers: {},
      // An attacker-style attempt to target a different order via the body
      // — the handler must never read this, only session.orderId.
      body: { enabled: true, orderId: 'someone-elses-order-999' },
    };
    const res = makeRes();
    await handler(req, res);

    expect(mockSetFreightNotifyPreference).toHaveBeenCalledWith('real-order-123', true);
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalledWith('someone-elses-order-999', expect.anything());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, enabled: true });
  });

  // AUDIT-2026-10-06 (follow-up): same ownership re-check as loadSessionOrder.
  it('refuses with 401 ORDER_NOT_OWNED when the order now belongs to another email', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockOrderIdBelongsToEmail.mockResolvedValue(false);

    const req = { method: 'POST', headers: {}, body: { enabled: true } };
    const res = makeRes();
    await handler(req, res);

    expect(mockOrderIdBelongsToEmail).toHaveBeenCalledWith('real-order-123', 'a@b.com');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('ORDER_NOT_OWNED');
    expect(mockSetFreightNotifyPreference).not.toHaveBeenCalled();
  });

  it('returns 500 without crashing when the Monday write fails', async () => {
    mockVerifyCustomerSession.mockResolvedValue({ email: 'a@b.com', orderId: 'real-order-123' });
    mockSetFreightNotifyPreference.mockRejectedValue(new Error('Monday API unavailable'));

    const req = { method: 'POST', headers: {}, body: { enabled: false } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
  });
});
