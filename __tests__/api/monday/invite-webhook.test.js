import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  COLS: { inviteStatus: 'color_mm5427cr', manualInvite: 'color_mm7mvqg9' },
  getOrderById: (...args) => mockGetOrderById(...args),
  getOrderMessages: (...args) => mockGetOrderMessages(...args),
  setStatusLabel: (...args) => mockSetStatusLabel(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  deleteUpdate: (...args) => mockDeleteUpdate(...args),
}));
const mockDeleteUpdate = vi.fn().mockResolvedValue(undefined);

const mockSendPortalInvitation = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  sendPortalInvitation: (...args) => mockSendPortalInvitation(...args),
}));

vi.mock('../../../lib/auth', () => ({
  secretsMatch: (a, b) => !!a && !!b && a === b,
}));

process.env.MONDAY_INVITE_SECRET = 'test-secret';

const { default: handler } = await import('../../../pages/api/monday/invite-webhook.js');

function makeReq(event) {
  return { method: 'POST', query: { secret: 'test-secret' }, headers: {}, body: { event } };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const ORDER = { id: '123', name: 'Acme Soar', customerEmail: 'pat@acme.test', pocName: 'Pat' };

describe('POST /api/monday/invite-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrderById.mockResolvedValue(ORDER);
    // Already invited once — the manual trigger must send anyway.
    mockGetOrderMessages.mockResolvedValue([{ body: '[PORTAL: Invitation Sent] earlier' }]);
  });

  it('"Manually Send Invite" resends the same invitation and flips that column to "Manually Sent Invite"', async () => {
    const res = makeRes();
    await handler(makeReq({ pulseId: 123, columnId: 'color_mm7mvqg9', value: { label: { text: 'Manually Send Invite' } } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, resend: true, manual: true });
    expect(mockSendPortalInvitation).toHaveBeenCalledWith('pat@acme.test', 'Pat', 'Acme Soar');
    const sent = mockPostTaggedUpdate.mock.calls.find((c) => c[1] === 'PORTAL: Invitation Sent');
    expect(sent[2]).toContain('re-sent');
    expect(sent[2]).toContain('"Manually Send Invite"');
    expect(mockSetStatusLabel).toHaveBeenCalledWith(123, 'manualInvite', 'Manually Sent Invite');
    expect(mockSetStatusLabel).not.toHaveBeenCalledWith(expect.anything(), 'inviteStatus', expect.anything());
  });

  it('any other label on the manual column sends nothing', async () => {
    for (const text of ['Manually Sent Invite', 'Do Not Send', 'TBD']) {
      const res = makeRes();
      await handler(makeReq({ pulseId: 123, columnId: 'color_mm7mvqg9', value: { label: { text } } }), res);
      expect(res.body.skipped).toBeTruthy();
    }
    expect(mockSendPortalInvitation).not.toHaveBeenCalled();
    expect(mockSetStatusLabel).not.toHaveBeenCalled();
  });

  it('the existing "Customer Portal Invite" trigger still flips its own column to "Invite Sent"', async () => {
    const res = makeRes();
    await handler(makeReq({ pulseId: 123, columnId: 'color_mm5427cr', value: { label: { text: 'Send Invite' } } }), res);

    expect(res.body).toMatchObject({ ok: true, manual: false });
    expect(mockSendPortalInvitation).toHaveBeenCalledTimes(1);
    expect(mockSetStatusLabel).toHaveBeenCalledWith(123, 'inviteStatus', 'Invite Sent');
  });
});

// Monday fires "Manufacturing Phase → Incoming Order" twice for an order
// created at Incoming Order; every new customer got two invites ~1s apart.
describe('POST /api/monday/invite-webhook — duplicate trigger guard', () => {
  const INCOMING = { pulseId: 123, columnId: 'status__1', value: { label: { text: 'Incoming Order' } } };
  const now = () => new Date().toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrderById.mockResolvedValue(ORDER);
  });

  it('the later of two simultaneous requests backs off and removes its claim', async () => {
    mockPostTaggedUpdate.mockResolvedValueOnce({ id: '502' }); // this request's claim
    mockGetOrderMessages.mockResolvedValue([
      { id: '501', body: '[PORTAL: Invitation Claim]\n…', created_at: now() }, // the other request's
      { id: '502', body: '[PORTAL: Invitation Claim]\n…', created_at: now() },
    ]);
    const res = makeRes();
    await handler(makeReq(INCOMING), res);

    expect(res.body.skipped).toMatch(/Duplicate/);
    expect(mockSendPortalInvitation).not.toHaveBeenCalled();
    expect(mockDeleteUpdate).toHaveBeenCalledWith('502');
  });

  it('the earliest claim sends once, then removes its claim', async () => {
    mockPostTaggedUpdate.mockResolvedValueOnce({ id: '501' });
    mockGetOrderMessages.mockResolvedValue([
      { id: '501', body: '[PORTAL: Invitation Claim]\n…', created_at: now() },
      { id: '502', body: '[PORTAL: Invitation Claim]\n…', created_at: now() },
    ]);
    const res = makeRes();
    await handler(makeReq(INCOMING), res);

    expect(res.body.ok).toBe(true);
    expect(mockSendPortalInvitation).toHaveBeenCalledTimes(1);
    expect(mockDeleteUpdate).toHaveBeenCalledWith('501');
  });

  it('skips when an invite was already sent in the last 2 minutes', async () => {
    mockPostTaggedUpdate.mockResolvedValueOnce({ id: '510' });
    mockGetOrderMessages.mockResolvedValue([
      { id: '500', body: '[PORTAL: Invitation Sent]\nsent', created_at: now() },
      { id: '510', body: '[PORTAL: Invitation Claim]\n…', created_at: now() },
    ]);
    const res = makeRes();
    await handler(makeReq(INCOMING), res);

    expect(res.body.skipped).toMatch(/Duplicate/);
    expect(mockSendPortalInvitation).not.toHaveBeenCalled();
  });

  it('a deliberate resend later on still sends', async () => {
    mockPostTaggedUpdate.mockResolvedValueOnce({ id: '510' });
    mockGetOrderMessages.mockResolvedValue([
      { id: '500', body: '[PORTAL: Invitation Sent]\nsent', created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      { id: '510', body: '[PORTAL: Invitation Claim]\n…', created_at: now() },
    ]);
    const res = makeRes();
    await handler(makeReq({ pulseId: 123, columnId: 'color_mm7mvqg9', value: { label: { text: 'Manually Send Invite' } } }), res);

    expect(res.body).toMatchObject({ ok: true, resend: true });
    expect(mockSendPortalInvitation).toHaveBeenCalledTimes(1);
  });
});
