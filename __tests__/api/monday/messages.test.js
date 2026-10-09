import { describe, it, expect, vi, beforeEach } from 'vitest';

// Audit 2026-10-09: customers got every Monday update on their order (staff
// notes, automation logs, creator emails) — only the portal UI filtered.

const mockGetServerSession = vi.fn();
vi.mock('next-auth/next', () => ({ getServerSession: (...a) => mockGetServerSession(...a) }));
vi.mock('../../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

const mockVerifyCustomerSession = vi.fn();
vi.mock('../../../lib/auth', () => ({
  verifyCustomerSession: (...a) => mockVerifyCustomerSession(...a),
  SESSION_COOKIE: 'summit_customer_session',
}));

const mockGetOrderMessages = vi.fn();
const mockPostOrderMessage = vi.fn();
const mockGetOrderById = vi.fn();
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getOrderMessages: (...a) => mockGetOrderMessages(...a),
  postOrderMessage: (...a) => mockPostOrderMessage(...a),
  getOrderById: (...a) => mockGetOrderById(...a),
  setStatusLabel: (...a) => mockSetStatusLabel(...a),
}));

const mockNotifyTeamNewMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({ notifyTeamNewMessage: (...a) => mockNotifyTeamNewMessage(...a) }));
vi.mock('../../../lib/replyNotify', () => ({ notifyPendingStaffReplies: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../lib/rateLimit', () => ({ allowRequest: () => true }));

const { default: handler } = await import('../../../pages/api/monday/messages.js');

function makeRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const HISTORY = [
  { id: '1', body: '[PORTAL][PORTAL:CUSTOMER]\nHi there', created_at: '2026-10-01', creator: { name: 'Bryan Shepherd', email: 'bryan@summitsensory.com' }, replies: [
    { id: '1r', body: 'Thanks!', created_at: '2026-10-02', creator: { name: 'Stephanie', email: 'stephanie@summitsensory.com' } },
  ] },
  { id: '2', body: 'Internal: customer is late paying, hold shipment', created_at: '2026-10-03', creator: { name: 'Kyle', email: 'kyle@summitsensory.com' }, replies: [] },
  { id: '3', body: '[PORTAL: Staff Viewing As Customer]\nstephanie@summitsensory.com started…', created_at: '2026-10-04', creator: { name: 'Bryan Shepherd', email: 'bryan@summitsensory.com' }, replies: [] },
  { id: '4', body: '[PORTAL][PORTAL:STAFF]\nYour order shipped', created_at: '2026-10-05', creator: { name: 'Bryan Shepherd', email: 'bryan@summitsensory.com' }, replies: [] },
];

describe('/api/monday/messages', () => {
  beforeEach(() => {
    mockGetServerSession.mockReset().mockResolvedValue(null);
    mockVerifyCustomerSession.mockReset().mockResolvedValue({ role: 'customer', email: 'c@school.org', orderId: 'o1' });
    mockGetOrderMessages.mockReset().mockResolvedValue(HISTORY);
    mockPostOrderMessage.mockReset();
    mockGetOrderById.mockReset();
    mockNotifyTeamNewMessage.mockClear();
  });

  it('customers get only portal chat, with no creator emails', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { orderId: 'o1' }, headers: { cookie: 'summit_customer_session=x' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.messages.map(m => m.id)).toEqual(['1', '4']);
    expect(JSON.stringify(res.body)).not.toMatch(/@summitsensory\.com|Internal:|Staff Viewing/);
    expect(res.body.messages[0]).toMatchObject({ isStaff: false, replies: [{ id: '1r', isStaff: true }] });
    expect(res.body.messages[1]).toMatchObject({ isStaff: true });
  });

  it('staff still get the full history', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: 'kyle@summitsensory.com' } });
    const res = makeRes();
    await handler({ method: 'GET', query: { orderId: 'o1' }, headers: {} }, res);
    expect(res.body.messages).toHaveLength(4);
  });

  it('a posted customer message returns 201 even if the follow-up order read fails', async () => {
    mockPostOrderMessage.mockResolvedValue({ id: '9', body: '[PORTAL][PORTAL:CUSTOMER]\nhello', created_at: 'now', creator: { name: 'Bryan', email: 'bryan@summitsensory.com' } });
    mockGetOrderById.mockRejectedValue(new Error('Monday timeout'));
    const res = makeRes();
    await handler({ method: 'POST', query: {}, body: { orderId: 'o1', body: 'hello' }, headers: { cookie: 'summit_customer_session=x' } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toMatchObject({ id: '9', isStaff: false });
    expect(JSON.stringify(res.body)).not.toMatch(/bryan@/);
  });
});
