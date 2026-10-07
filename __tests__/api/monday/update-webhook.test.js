import { describe, it, expect, vi, beforeEach } from 'vitest';

// The webhook is now only a "something changed on item X" signal: it calls
// lib/replyNotify.js, which re-reads the item's history and decides. The
// decision logic itself is tested in __tests__/lib/replyNotify.test.js.
const mockNotifyPending = vi.fn();
vi.mock('../../../lib/replyNotify', () => ({
  notifyPendingStaffReplies: (...args) => mockNotifyPending(...args),
}));

vi.mock('../../../lib/auth', () => ({
  secretsMatch: (a, b) => !!a && !!b && a === b,
}));

process.env.MONDAY_UPDATE_WEBHOOK_SECRET = 'test-secret';

const { default: handler } = await import('../../../pages/api/monday/update-webhook.js');

function makeReq(body, secret = 'test-secret') {
  return { method: 'POST', query: { secret }, body };
}

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const event = (over = {}) => ({ event: { type: 'create_update', pulseId: 456, updateId: 789, userId: 1, body: 'x', textBody: 'x', ...over } });

describe('POST /api/monday/update-webhook', () => {
  beforeEach(() => {
    mockNotifyPending.mockReset().mockResolvedValue({ sent: false, ids: [] });
  });

  it('rejects a request without the secret and touches nothing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();
    await handler(makeReq(event(), 'wrong'), res);
    expect(res.statusCode).toBe(401);
    expect(mockNotifyPending).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('echoes the Monday challenge', async () => {
    const res = makeRes();
    await handler(makeReq({ challenge: 'abc' }, undefined), res);
    expect(res.body).toEqual({ challenge: 'abc' });
  });

  it('checks the item from a native Monday event for unnotified staff replies', async () => {
    mockNotifyPending.mockResolvedValue({ sent: true, ids: ['reply 2'] });
    const res = makeRes();
    await handler(makeReq(event()), res);
    expect(mockNotifyPending).toHaveBeenCalledWith(456);
    expect(res.statusCode).toBe(200);
    expect(res.body.notified).toEqual(['reply 2']);
  });

  it('accepts the flat { itemId } shape used for manual testing', async () => {
    const res = makeRes();
    await handler(makeReq({ itemId: 'item-9' }), res);
    expect(mockNotifyPending).toHaveBeenCalledWith('item-9');
    expect(res.body.skipped).toBeTruthy();
  });

  it('answers 200 (never 400) for a payload with no item id', async () => {
    const res = makeRes();
    await handler(makeReq({ event: { type: 'create_update' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockNotifyPending).not.toHaveBeenCalled();
  });

  it('answers 200 even when the send fails — the safety-net cron retries, and repeated failures would get the webhook deactivated', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNotifyPending.mockRejectedValue(new Error('resend down'));
    const res = makeRes();
    await handler(makeReq(event()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    err.mockRestore();
  });
});
