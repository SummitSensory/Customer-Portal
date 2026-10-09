import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockSendOnce = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...a) => mockGetOrderById(...a),
  sendCustomerNotificationOnce: (...a) => mockSendOnce(...a),
  COLS: { status: 'status__1' },
}));
const mockNotify = vi.fn().mockResolvedValue({ id: 'e1' });
vi.mock('../../../lib/email', () => ({
  notifyCustomerStatusChange: (...a) => mockNotify(...a),
  isCustomerFacingStatus: () => true,
}));
vi.mock('../../../lib/auth', () => ({ secretsMatch: (a, b) => !!a && a === b }));
const mockReport = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: (...a) => mockReport(...a) }));

process.env.MONDAY_STATUS_WEBHOOK_SECRET = 's';
const { default: handler } = await import('../../../pages/api/monday/status-balance-webhook.js');

function makeRes() {
  const res = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}
const req = () => ({ method: 'POST', query: { secret: 's' }, headers: {}, body: { event: { pulseId: '9', columnId: 'status__1', triggerUuid: 'trig-1' } } });

describe('POST /api/monday/status-balance-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue({ id: 'e1' });
    mockGetOrderById.mockResolvedValue({ id: '9', name: 'Acme', customerEmail: 'a@b.org', contactName: 'Pat', status: 'Shipped' });
  });

  // Audit 2026-10-09: a marker failure AFTER the email went out answered
  // 500, so Monday redelivered and the customer got the email again.
  it('answers 200 (no Monday retry) and alerts when the marker fails after a successful send', async () => {
    mockSendOnce.mockImplementation(async (id, kind, value, sendFn) => { await sendFn(); throw new Error('marker write failed'); });
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.markFailed).toBe(true);
    expect(mockReport).toHaveBeenCalledWith('monday/status-balance-webhook', expect.stringContaining('[PORTAL: Status Notified - Shipped]'), expect.anything());
  });

  it("passes a Resend idempotency key derived from Monday's triggerUuid", async () => {
    mockSendOnce.mockImplementation(async (id, kind, value, sendFn) => { await sendFn(); return { sent: true }; });
    const res = makeRes();
    await handler(req(), res);
    expect(mockNotify).toHaveBeenCalledWith('a@b.org', 'Pat', 'Acme', 'Shipped', { idempotencyKey: 'status/9/trig-1' });
  });

  it('still answers 500 when the send itself fails (nothing went out, so a retry is safe)', async () => {
    mockNotify.mockRejectedValueOnce(new Error('Resend down'));
    mockSendOnce.mockImplementation(async (id, kind, value, sendFn) => { await sendFn(); return { sent: true }; });
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(500);
  });

  it('handles the {sent:true, markFailed:true} result shape as success', async () => {
    mockSendOnce.mockResolvedValue({ sent: true, markFailed: true });
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
  });
});
