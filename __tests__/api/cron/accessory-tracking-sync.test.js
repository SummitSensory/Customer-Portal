// AUDIT-2026-10-06: the hourly AfterShip sync must never write a made-up
// status, never overwrite real AfterShip recipients with "unknown", and must
// alert when AfterShip itself is what's failing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const monday = {
  getAllAccessoryItems: vi.fn(),
  updateAccessoryCarrierStatus: vi.fn(),
  getAllOrders: vi.fn(),
  getOrderById: vi.fn(),
  resolveDeliveryContacts: vi.fn(() => ({ primary: { name: 'Pat', email: 'pat@school.org' }, secondary: null })),
};
vi.mock('../../../lib/monday', () => monday);

const trackShipment = vi.fn();
const onboardShipment = vi.fn();
vi.mock('../../../lib/aftership', () => ({
  trackShipment: (...a) => trackShipment(...a),
  onboardShipment: (...a) => onboardShipment(...a),
  buildTrackingTitle: (name, key, detail) => `${name || ''} ${detail || key}`.trim(),
  buildCustomFields: (key, contacts) => ({ shipment_type: key, ...(contacts[0] ? { first_name: contacts[0].name } : {}) }),
  isPermanentAftershipError: (err) => err?.status === 404,
}));

const reportCriticalFailure = vi.fn();
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: (...a) => reportCriticalFailure(...a) }));

const { default: handler } = await import('../../../pages/api/cron/accessory-tracking-sync.js');

function makeRes() {
  const res = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}
const req = () => ({ headers: { authorization: 'Bearer cron-secret' } });

describe('cron/accessory-tracking-sync', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('AFTERSHIP_API_KEY', 'k');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const fn of Object.values(monday)) fn.mockClear();
    trackShipment.mockReset();
    onboardShipment.mockReset().mockResolvedValue('ast-1');
    reportCriticalFailure.mockReset();
    monday.getAllOrders.mockResolvedValue([{ id: 'o1', name: 'Acme' }]);
    monday.getAllAccessoryItems.mockResolvedValue([{ id: 's1', orderId: 'o1', name: 'Swing', carrierSlug: 'ups', trackingNumber: '1Z', carrierStatus: 'In Transit' }]);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('rejects a wrong cron secret', async () => {
    const res = makeRes();
    await handler({ headers: { authorization: 'Bearer nope' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('leaves Monday alone when AfterShip fails (no "Pending" over a real status), and alerts when every item failed', async () => {
    trackShipment.mockResolvedValue(null);
    const res = makeRes();
    await handler(req(), res);
    expect(monday.updateAccessoryCarrierStatus).not.toHaveBeenCalled();
    expect(res.body.trackingFailed).toBe(1);
    expect(reportCriticalFailure).toHaveBeenCalledWith('cron/accessory-tracking-sync', expect.stringContaining('every tracked item failed'), expect.any(Object));
  });

  it('does not alert for a single bad tracking number (permanent 4xx)', async () => {
    trackShipment.mockImplementation(async (_s, _n, meta) => { meta.onError({ status: 404 }); return null; });
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.badTrackingData).toBe(1);
    expect(reportCriticalFailure).not.toHaveBeenCalled();
  });

  it('writes a real status change', async () => {
    trackShipment.mockResolvedValue({ status: 'Delivered' });
    const res = makeRes();
    await handler(req(), res);
    expect(monday.updateAccessoryCarrierStatus).toHaveBeenCalledWith('s1', 'Delivered');
  });

  it('marks contacts unknown (not empty) when the orders board failed to load', async () => {
    monday.getAllOrders.mockRejectedValue(new Error('timeout'));
    trackShipment.mockResolvedValue({ status: 'In Transit' });
    await handler(req(), makeRes());
    const meta = trackShipment.mock.calls[0][2];
    expect(meta.contactsUnknown).toBe(true);
  });

  it('marks contacts unknown when the full order (with mirrors) cannot be loaded', async () => {
    monday.getAllOrders.mockResolvedValue([{ id: 'o1', name: 'Acme', freightNotifyEnabled: true, frameCarrierSlug: 'fedex', frameTrackingId: '77' }]);
    monday.getOrderById.mockRejectedValue(new Error('timeout'));
    trackShipment.mockResolvedValue({ status: 'In Transit' });
    await handler(req(), makeRes());
    expect(trackShipment.mock.calls[0][2].contactsUnknown).toBe(true);
    expect(onboardShipment.mock.calls[0][2].contactsUnknown).toBe(true);
  });

  it('passes resolved contacts normally', async () => {
    trackShipment.mockResolvedValue({ status: 'In Transit' });
    await handler(req(), makeRes());
    const meta = trackShipment.mock.calls[0][2];
    expect(meta.contactsUnknown).toBe(false);
    expect(meta.contacts).toEqual([{ name: 'Pat', email: 'pat@school.org' }]);
  });

  it('alerts and stops when AFTERSHIP_API_KEY is missing in production', async () => {
    vi.stubEnv('AFTERSHIP_API_KEY', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = makeRes();
    await handler(req(), res);
    expect(res.statusCode).toBe(500);
    expect(reportCriticalFailure).toHaveBeenCalledWith('cron/accessory-tracking-sync', expect.stringContaining('AFTERSHIP_API_KEY'), expect.any(Object));
  });
});
