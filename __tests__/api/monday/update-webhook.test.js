import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockGetOrderByEmail = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  getOrderByEmail: (...args) => mockGetOrderByEmail(...args),
  getOrderMessages: (...args) => mockGetOrderMessages(...args),
  setStatusLabel: (...args) => mockSetStatusLabel(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
}));

const mockSendCustomerReplyNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  sendCustomerReplyNotification: (...args) => mockSendCustomerReplyNotification(...args),
}));

vi.mock('../../../lib/auth', () => ({
  isStaffEmail: (email) => (email || '').endsWith('@summitsensory.com'),
  secretsMatch: (a, b) => !!a && !!b && a === b,
}));

vi.mock('../../../lib/messageOrigin', () => ({
  isPortalChatMessage: (msg) => (msg?.body || '').startsWith('[PORTAL]'),
  isStaffMessage: (msg) => (msg?.body || '').startsWith('[PORTAL][PORTAL:STAFF]'),
}));

process.env.MONDAY_UPDATE_WEBHOOK_SECRET = 'test-secret';

const { default: handler } = await import('../../../pages/api/monday/update-webhook.js');

function makeReq(body) {
  return { method: 'POST', query: { secret: 'test-secret' }, body };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

// PORTAL-064: this webhook previously posted its "[PORTAL: Reply Notified]"
// dedupe tag only AFTER sending — never checked for one BEFORE — so a
// Monday retry of the same "update created" event (slow/ambiguous
// response, a timeout after the email already went out) would re-send the
// customer a duplicate "new message" notification. The fix looks up the
// real reply in the order's own update history and checks whether a
// notified-tag already exists at or after that reply's timestamp, BEFORE
// doing anything.
describe('POST /api/monday/update-webhook — PORTAL-064 redelivery guard', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockGetOrderByEmail.mockReset();
    mockGetOrderMessages.mockReset();
    mockSetStatusLabel.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockSendCustomerReplyNotification.mockReset().mockResolvedValue(undefined);
  });

  const STAFF_REPLY_BODY = 'Thanks, we will get that shipped out today.';
  const STAFF_EMAIL = 'staff@summitsensory.com';

  it('a first delivery for a real staff reply sends the notification and posts the marker', async () => {
    // The reply itself is already in the order's update history (it's what
    // triggered the webhook) but with no "[PORTAL: Reply Notified]" tag at
    // or after it yet.
    mockGetOrderMessages.mockResolvedValue([
      { body: STAFF_REPLY_BODY, creator: { email: STAFF_EMAIL }, created_at: '2026-09-21T10:00:00.000Z' },
    ]);
    mockGetOrderById.mockResolvedValue({ id: '123', customerEmail: 'customer@example.com', pocName: 'Jane', name: 'Order 123' });

    const res = makeRes();
    await handler(makeReq({ itemId: '123', updateBody: STAFF_REPLY_BODY, creatorEmail: STAFF_EMAIL }), res);

    expect(mockSendCustomerReplyNotification).toHaveBeenCalledTimes(1);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('123', 'PORTAL: Reply Notified', expect.any(String));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('a Monday redelivery of the SAME reply (marker already posted at/after its timestamp) is skipped, no duplicate email', async () => {
    mockGetOrderMessages.mockResolvedValue([
      { body: STAFF_REPLY_BODY, creator: { email: STAFF_EMAIL }, created_at: '2026-09-21T10:00:00.000Z' },
      { body: '[PORTAL: Reply Notified] Staff reply notification emailed to customer@example.com on 9/21/2026.', creator: { email: 'api@monday.com' }, created_at: '2026-09-21T10:00:05.000Z' },
    ]);

    const res = makeRes();
    await handler(makeReq({ itemId: '123', updateBody: STAFF_REPLY_BODY, creatorEmail: STAFF_EMAIL }), res);

    expect(mockSendCustomerReplyNotification).not.toHaveBeenCalled();
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
    expect(mockGetOrderById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'Already notified for this reply (redelivery).' });
  });

  it('a DIFFERENT, later staff reply on the same order is still notified even though an earlier reply already has a marker', async () => {
    mockGetOrderMessages.mockResolvedValue([
      { body: 'First reply', creator: { email: STAFF_EMAIL }, created_at: '2026-09-21T09:00:00.000Z' },
      { body: '[PORTAL: Reply Notified] Staff reply notification emailed to customer@example.com on 9/21/2026.', creator: { email: 'api@monday.com' }, created_at: '2026-09-21T09:00:05.000Z' },
      { body: 'Second, different reply', creator: { email: STAFF_EMAIL }, created_at: '2026-09-21T11:00:00.000Z' },
    ]);
    mockGetOrderById.mockResolvedValue({ id: '123', customerEmail: 'customer@example.com', pocName: 'Jane', name: 'Order 123' });

    const res = makeRes();
    await handler(makeReq({ itemId: '123', updateBody: 'Second, different reply', creatorEmail: STAFF_EMAIL }), res);

    expect(mockSendCustomerReplyNotification).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ ok: true });
  });

  it('if the triggering reply cannot be found in the update history yet, fails toward SENDING rather than silently dropping it', async () => {
    // Read-after-write lag: getOrderMessages doesn't show this reply yet at all.
    mockGetOrderMessages.mockResolvedValue([]);
    mockGetOrderById.mockResolvedValue({ id: '123', customerEmail: 'customer@example.com', pocName: 'Jane', name: 'Order 123' });

    const res = makeRes();
    await handler(makeReq({ itemId: '123', updateBody: STAFF_REPLY_BODY, creatorEmail: STAFF_EMAIL }), res);

    expect(mockSendCustomerReplyNotification).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ ok: true });
  });
});
