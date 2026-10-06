import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockGetOrderByEmail = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockGetUpdateById = vi.fn();
vi.mock('../../../lib/monday', () => ({
  getOrderById: (...args) => mockGetOrderById(...args),
  getOrderByEmail: (...args) => mockGetOrderByEmail(...args),
  getOrderMessages: (...args) => mockGetOrderMessages(...args),
  setStatusLabel: (...args) => mockSetStatusLabel(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  getUpdateById: (...args) => mockGetUpdateById(...args),
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

// Monday's "When a new update posted, send a webhook" integration sends its
// standard event payload, not the flat { itemId, updateBody, creatorEmail }
// this endpoint originally expected — every real delivery 400'd until
// 2026-10-05. The creator's email comes from looking the update up by id.
describe('POST /api/monday/update-webhook — Monday native event payload', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockGetOrderMessages.mockReset().mockResolvedValue([]);
    mockGetUpdateById.mockReset();
    mockSetStatusLabel.mockReset().mockResolvedValue(undefined);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockSendCustomerReplyNotification.mockReset().mockResolvedValue(undefined);
  });

  const event = (over = {}) => ({ event: { type: 'create_update', pulseId: 456, updateId: 789, userId: 1, body: 'x', textBody: 'x', ...over } });

  it('a staff reply typed in Monday is looked up by updateId and emailed to the customer', async () => {
    mockGetUpdateById.mockResolvedValue({ id: '789', body: 'We can ship Friday.', creator: { email: 'kyle@summitsensory.com' } });
    mockGetOrderById.mockResolvedValue({ id: '456', customerEmail: 'customer@example.com', firstName: 'Alyson', name: 'Order 456' });

    const res = makeRes();
    await handler(makeReq(event()), res);

    expect(mockGetUpdateById).toHaveBeenCalledWith(789);
    expect(res.statusCode).toBe(200);
    expect(mockSendCustomerReplyNotification).toHaveBeenCalledWith('customer@example.com', 'Alyson', 'Order 456', 'We can ship Friday.');
  });

  it("the portal's own tagged audit notes are skipped without emailing anyone", async () => {
    mockGetUpdateById.mockResolvedValue({ id: '789', body: '[PORTAL: Webhook Test]<br>internal', creator: { email: 'bryan@summitsensory.com' } });

    const res = makeRes();
    await handler(makeReq(event()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBeTruthy();
    expect(mockSendCustomerReplyNotification).not.toHaveBeenCalled();
  });

  it('a failed update lookup returns 500 so Monday retries', async () => {
    mockGetUpdateById.mockRejectedValue(new Error('monday down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await handler(makeReq(event()), res);

    expect(res.statusCode).toBe(500);
    expect(mockSendCustomerReplyNotification).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('an update deleted before the lookup (e.g. an invite claim note) is a 200 skip, not a 400', async () => {
    mockGetUpdateById.mockResolvedValue(null);

    const res = makeRes();
    await handler(makeReq(event()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.skipped).toBeTruthy();
    expect(mockSendCustomerReplyNotification).not.toHaveBeenCalled();
  });
});
