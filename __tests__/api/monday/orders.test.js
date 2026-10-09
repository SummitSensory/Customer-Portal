import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSession = vi.fn();
vi.mock('next-auth/next', () => ({ getServerSession: (...a) => mockSession(...a) }));
vi.mock('../../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const m = {
  getAllOrders: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateTrackingNumber: vi.fn(),
  updateBalance: vi.fn(),
  sendCustomerNotificationOnce: vi.fn(),
};
vi.mock('../../../lib/monday', () => Object.fromEntries(Object.keys(m).map(k => [k, (...a) => m[k](...a)])));
vi.mock('../../../lib/email', () => ({
  notifyCustomerStatusChange: vi.fn(),
  isCustomerFacingStatus: () => true,
}));

const { default: handler } = await import('../../../pages/api/monday/orders.js');

function res() {
  const r = { statusCode: 200 };
  r.status = vi.fn(c => { r.statusCode = c; return r; });
  r.json = vi.fn(b => { r.body = b; return r; });
  r.end = vi.fn(() => r);
  return r;
}

const ORDER = { id: '1', status: 'Incoming Order', trackingNumber: '', balance: 100, customerEmail: 'a@b.com', name: 'Order' };

beforeEach(() => {
  Object.values(m).forEach(f => f.mockReset());
  mockSession.mockReset().mockResolvedValue({ user: { email: 'staff@summitsensory.com' } });
  m.getOrderById.mockResolvedValue(ORDER);
});

describe('/api/monday/orders', () => {
  it('requires a staff session', async () => {
    mockSession.mockResolvedValue(null);
    const r = res();
    await handler({ method: 'GET', query: { id: '1' } }, r);
    expect(r.statusCode).toBe(401);
  });

  it('GET ?id= returns the full getOrderById record (mirror columns) for the admin panel', async () => {
    const r = res();
    await handler({ method: 'GET', query: { id: '1' } }, r);
    expect(m.getOrderById).toHaveBeenCalledWith('1');
    expect(m.getAllOrders).not.toHaveBeenCalled();
    expect(r.body).toEqual({ order: ORDER });
  });

  it('a later field failing does not hide that the status saved and the customer was emailed', async () => {
    m.updateOrderStatus.mockResolvedValue({});
    m.sendCustomerNotificationOnce.mockResolvedValue({ sent: true });
    m.updateBalance.mockRejectedValue(new Error('Monday 500'));
    const r = res();
    await handler({ method: 'PATCH', query: { id: '1' }, body: { status: 'Shipped', balance: '50' } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.saved).toEqual(['status']);
    expect(r.body.failed).toEqual(['balance']);
    expect(r.body.warnings.join(' ')).toMatch(/Balance was NOT saved/);
  });

  it('a marker failure after a successful send is reported as sent, not as a failed email', async () => {
    m.updateOrderStatus.mockResolvedValue({});
    m.sendCustomerNotificationOnce.mockResolvedValue({ sent: true, markFailed: true });
    const r = res();
    await handler({ method: 'PATCH', query: { id: '1' }, body: { status: 'Shipped' } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.warnings.join(' ')).toMatch(/WAS emailed/);
    expect(r.body.warnings.join(' ')).not.toMatch(/failed:/);
  });

  it('500 only when every attempted write failed', async () => {
    m.updateOrderStatus.mockRejectedValue(new Error('Monday down'));
    const r = res();
    await handler({ method: 'PATCH', query: { id: '1' }, body: { status: 'Shipped' } }, r);
    expect(r.statusCode).toBe(500);
    expect(r.body.failed).toEqual(['status']);
  });
});
