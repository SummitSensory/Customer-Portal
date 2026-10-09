import { describe, it, expect, beforeAll } from 'vitest';

// Audit 2026-10-09: login-code tokens and customer sessions share one signing
// secret, and verifyCustomerSession only checked the signature — so the code
// cookie send-code issues for any email worked as that customer's session.

let auth;
beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-auth-tests';
  auth = await import('./auth');
});

describe('token type separation', () => {
  it('a login-code token is NOT accepted as a customer session', async () => {
    const codeToken = await auth.signCodeToken('victim@school.org', '123456');
    expect(await auth.verifyCustomerSession(codeToken)).toBeNull();
  });

  it('a customer session is NOT accepted as a login-code token', async () => {
    const session = await auth.signCustomerSession('a@b.com', '1', 'Order');
    expect(await auth.verifyCodeToken(session)).toBeNull();
  });

  it('real sessions still verify, with or without a bound order', async () => {
    expect(await auth.verifyCustomerSession(await auth.signCustomerSession('a@b.com', '1', 'Order')))
      .toMatchObject({ email: 'a@b.com', orderId: '1', role: 'customer' });
    expect(await auth.verifyCustomerSession(await auth.signCustomerSession('a@b.com', undefined, undefined)))
      .toMatchObject({ email: 'a@b.com', role: 'customer' });
    expect(await auth.verifyCustomerSession(await auth.signImpersonationSession('a@b.com', '1', 'Order', 'staff@summitsensory.com')))
      .toMatchObject({ impersonatedBy: 'staff@summitsensory.com' });
  });

  it('real code tokens still verify', async () => {
    const payload = await auth.verifyCodeToken(await auth.signCodeToken('a@b.com', '123456'));
    expect(payload).toMatchObject({ email: 'a@b.com', attempts: 0 });
    expect(auth.codeMatchesHash('123456', payload.codeHash)).toBe(true);
  });
});
