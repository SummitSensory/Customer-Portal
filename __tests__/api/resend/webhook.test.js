import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import crypto from 'crypto';

const mockGetOrderIdsByEmail = vi.fn().mockResolvedValue([]);
vi.mock('../../../lib/monday', () => ({
  getOrderIdsByEmail: (...a) => mockGetOrderIdsByEmail(...a),
  getOrderMessages: async () => [],
  postTaggedUpdate: async () => undefined,
}));
const mockAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  sendInternalAlert: (...a) => mockAlert(...a),
  isInternalAlertAddress: (a) => a === 'alerts@summitsensory.com',
}));

const SECRET_BYTES = Buffer.from('test-secret-bytes');
process.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;
const { default: handler } = await import('../../../pages/api/resend/webhook.js');

function signedReq(payload) {
  const body = JSON.stringify(payload);
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', SECRET_BYTES).update(`${id}.${ts}.${body}`).digest('base64');
  const req = new EventEmitter();
  req.method = 'POST';
  req.setEncoding = () => {};
  req.headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
  setTimeout(() => { req.emit('data', body); req.emit('end'); }, 0);
  return req;
}
function makeRes() {
  const res = {};
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

describe('POST /api/resend/webhook — alert loop guard', () => {
  beforeEach(() => vi.clearAllMocks());

  // Audit 2026-10-09: a bounce of the alert inbox itself sent an alert to
  // that same bouncing inbox, which bounced again — a loop.
  it('never alerts about the internal alert address bouncing', async () => {
    const res = makeRes();
    await handler(signedReq({ type: 'email.bounced', data: { to: ['alerts@summitsensory.com'], subject: 'x' } }), res);
    expect(res.statusCode).toBe(200);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('still alerts about a customer address bouncing', async () => {
    const res = makeRes();
    await handler(signedReq({ type: 'email.bounced', data: { to: ['pat@school.org'], subject: 'x' } }), res);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
});
