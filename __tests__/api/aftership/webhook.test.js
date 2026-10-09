import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockFindAccessory = vi.fn();
const mockUpdateAccessory = vi.fn().mockResolvedValue(undefined);
const mockFindOrder = vi.fn();
const mockUpdateTag = vi.fn().mockResolvedValue(undefined);
const mockMondayQuery = vi.fn();
vi.mock('../../../lib/monday', () => ({
  findAccessorySubitemByTracking: (...a) => mockFindAccessory(...a),
  updateAccessoryCarrierStatus: (...a) => mockUpdateAccessory(...a),
  findOrderByFreightTracking: (...a) => mockFindOrder(...a),
  updateFreightNotifyTag: (...a) => mockUpdateTag(...a),
  getCustomerFirstName: async () => 'Pat',
  mondayQuery: (...a) => mockMondayQuery(...a),
  COLS: { frameNotifyTag: 'text_frame', matsNotifyTag: 'text_mats' },
}));
const mockNotify = vi.fn().mockResolvedValue({ id: 'e1' });
vi.mock('../../../lib/email', () => ({ notifyCustomerFreightUpdate: (...a) => mockNotify(...a) }));

process.env.AFTERSHIP_WEBHOOK_SECRET = 'whsec';
const { default: handler } = await import('../../../pages/api/aftership/webhook.js');

function makeReq(payload) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = { 'x-webhook-secret': 'whsec' };
  setTimeout(() => { req.emit('data', JSON.stringify(payload)); req.emit('end'); }, 0);
  return req;
}
function makeRes() {
  const res = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}
const EVENT = { msg: { slug: 'ups', tracking_number: 'PRO1', tag: 'Delivered' } };
const ORDER = { itemId: '7', orderName: 'Acme', shipmentKey: 'frame', customerEmail: 'a@b.org', contactName: 'Pat', freightNotifyEnabled: true, lastNotifiedTag: 'Out for Delivery' };
const freshTag = (text) => mockMondayQuery.mockResolvedValue({ items: [{ column_values: [{ text }] }] });

describe('POST /api/aftership/webhook — audit 2026-10-09', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue({ id: 'e1' });
    mockFindAccessory.mockResolvedValue(null);
    mockFindOrder.mockResolvedValue(ORDER);
    freshTag('Out for Delivery');
  });

  it('re-reads the notify tag uncached and skips when another instance already emailed this status', async () => {
    freshTag('Delivered'); // the cache still says "Out for Delivery"
    const res = makeRes();
    await handler(makeReq(EVENT), res);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(res.body.skipped).toMatch(/Already notified/);
  });

  it('sends with an idempotency key when the fresh tag is older', async () => {
    const res = makeRes();
    await handler(makeReq(EVENT), res);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][6]).toEqual({ idempotencyKey: 'freight/7/frame/PRO1/Delivered' });
    expect(mockUpdateTag).toHaveBeenCalledWith('7', 'frame', 'Delivered');
  });

  it('an accessory on the same tracking number no longer blocks the frame email', async () => {
    mockFindAccessory.mockResolvedValue({ id: 'sub-1' });
    const res = makeRes();
    await handler(makeReq(EVENT), res);
    expect(mockUpdateAccessory).toHaveBeenCalledWith('sub-1', expect.any(String));
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('answers 5xx on a lookup failure so AfterShip retries (Delivered has no later status)', async () => {
    mockFindOrder.mockRejectedValue(new Error('Monday timeout'));
    const res = makeRes();
    await handler(makeReq(EVENT), res);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it('answers 5xx when the send fails (nothing marked, retry sends once)', async () => {
    mockNotify.mockRejectedValue(new Error('Resend down'));
    const res = makeRes();
    await handler(makeReq(EVENT), res);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
