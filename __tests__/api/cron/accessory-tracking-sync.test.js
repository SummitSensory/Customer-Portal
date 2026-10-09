import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAllAccessoryItems = vi.fn();
const mockUpdateAccessoryCarrierStatus = vi.fn().mockResolvedValue(undefined);
const mockGetAllOrders = vi.fn();
const mockGetOrderById = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getAllAccessoryItems: (...a) => mockGetAllAccessoryItems(...a),
  updateAccessoryCarrierStatus: (...a) => mockUpdateAccessoryCarrierStatus(...a),
  getAllOrders: (...a) => mockGetAllOrders(...a),
  getOrderById: (...a) => mockGetOrderById(...a),
  resolveDeliveryContacts: (o) => ({ primary: o.pocEmail ? { name: o.pocName, email: o.pocEmail } : null, secondary: null }),
}));

const mockTrackShipment = vi.fn();
const mockOnboardShipment = vi.fn();
vi.mock('../../../lib/aftership', () => ({
  trackShipment: (...a) => mockTrackShipment(...a),
  onboardShipment: (...a) => mockOnboardShipment(...a),
  buildTrackingTitle: (name, key, detail) => [name, key, detail].filter(Boolean).join(' — '),
  buildCustomFields: () => ({ shipment_type: 'x' }),
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: (...a) => mockReportCriticalFailure(...a) }));

const { default: handler } = await import('../../../pages/api/cron/accessory-tracking-sync.js');

function makeRes() {
  const res = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}
const req = () => ({ headers: { authorization: 'Bearer cron' } });
const ITEM = { id: 'sub-1', name: 'Weighted Blanket', orderId: 'ord-1', carrierSlug: 'ups', trackingNumber: '1Z', carrierStatus: '' };

describe('GET /api/cron/accessory-tracking-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron';
    mockGetAllAccessoryItems.mockResolvedValue([ITEM]);
    mockTrackShipment.mockResolvedValue({ status: 'In Transit' });
    mockOnboardShipment.mockResolvedValue('ast-1');
  });

  it('rejects a wrong cron secret', async () => {
    const res = makeRes();
    await handler({ headers: { authorization: 'Bearer nope' } }, res);
    expect(res.statusCode).toBe(401);
  });

  // Audit 2026-10-09: getAllOrders() timing out used to rewrite every
  // accessory tracking's customers with just the item name.
  it('when the orders board fails to load, AfterShip customers are left alone (skipCustomers)', async () => {
    mockGetAllOrders.mockRejectedValue(new Error('timeout'));
    const res = makeRes();
    await handler(req(), res);
    expect(mockTrackShipment).toHaveBeenCalledWith('ups', '1Z', expect.objectContaining({ skipCustomers: true, title: undefined }));
  });

  it('when the full-order (mirror) load fails for an opted-in order, customers are left alone', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: 'ord-1', name: 'Acme', freightNotifyEnabled: true, deliverySnapshot: null }]);
    mockGetOrderById.mockRejectedValue(new Error('timeout'));
    const res = makeRes();
    await handler(req(), res);
    expect(mockTrackShipment).toHaveBeenCalledWith('ups', '1Z', expect.objectContaining({ skipCustomers: true }));
  });

  it('resolved contacts are still sent', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: 'ord-1', name: 'Acme', freightNotifyEnabled: true, deliverySnapshot: null }]);
    mockGetOrderById.mockResolvedValue({ id: 'ord-1', pocName: 'Pat', pocEmail: 'pat@acme.org' });
    const res = makeRes();
    await handler(req(), res);
    expect(mockTrackShipment).toHaveBeenCalledWith('ups', '1Z', expect.objectContaining({
      skipCustomers: false,
      contacts: [{ name: 'Pat', email: 'pat@acme.org' }],
    }));
  });

  it('counts a null tracking result as a failure, so an all-failed run alerts', async () => {
    mockGetAllOrders.mockResolvedValue([]);
    mockTrackShipment.mockResolvedValue(null);
    const res = makeRes();
    await handler(req(), res);
    expect(res.body.errors).toBe(1);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('cron/accessory-tracking-sync', expect.stringContaining('every tracked item failed'), expect.anything());
  });

  it('alerts when every Frame/Mats onboarding fails', async () => {
    mockGetAllAccessoryItems.mockResolvedValue([]);
    mockGetAllOrders.mockResolvedValue([{ id: 'ord-1', name: 'Acme', frameCarrierSlug: 'ups', frameTrackingId: 'F1' }]);
    mockOnboardShipment.mockResolvedValue(null);
    const res = makeRes();
    await handler(req(), res);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('cron/accessory-tracking-sync', expect.stringContaining('Frame/Mats'), expect.anything());
  });
});
