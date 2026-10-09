import { describe, it, expect, vi, beforeAll } from 'vitest';

// Audit 2026-10-09: replaying the ORIGINAL code cookie (attempts: 0) reset
// the per-code wrong-guess counter, and the only other limit was per IP.

vi.mock('../../../lib/monday', () => ({
  getOrdersByEmail: vi.fn().mockResolvedValue([{ id: 'o1', name: 'Order' }]),
}));
// Each request looks like a different IP, so only the new limits apply.
let ip = 0;
vi.mock('../../../lib/rateLimit', async (orig) => {
  const real = await orig();
  return { ...real, getClientIp: () => `10.0.0.${++ip}` };
});

let handler, auth;
beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-auth-tests';
  auth = await import('../../../lib/auth');
  ({ default: handler } = await import('../../../pages/api/auth/verify-code.js'));
});

function makeRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
  return res;
}

async function attempt(token, code) {
  const res = makeRes();
  await handler({ method: 'POST', body: { code }, headers: { cookie: `summit_code_token=${token}` } }, res);
  return res;
}

describe('verify-code brute-force limits', () => {
  it('replaying the original cookie does not reset the wrong-guess count', async () => {
    const original = await auth.signCodeToken('replay@school.org', '111111');
    for (let i = 0; i < auth.MAX_CODE_ATTEMPTS; i++) {
      expect((await attempt(original, '000000')).statusCode).toBe(401);
    }
    // Same original cookie (attempts: 0 inside) — and even the right code — is now refused.
    expect((await attempt(original, '111111')).statusCode).toBe(429);
  });

  it('caps attempts per email even across freshly issued codes', async () => {
    let last;
    for (let i = 0; i < 11; i++) {
      const token = await auth.signCodeToken('spray@school.org', '222222');
      last = await attempt(token, '000000');
    }
    expect(last.statusCode).toBe(429);
  });

  it('a correct code still logs in', async () => {
    const token = await auth.signCodeToken('ok@school.org', '333333');
    const res = await attempt(token, '333333');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
