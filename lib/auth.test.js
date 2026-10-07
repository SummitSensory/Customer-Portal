import { describe, it, expect } from 'vitest';
import {
  signCodeToken,
  signCustomerSession,
  signImpersonationSession,
  verifyCodeToken,
  verifyCustomerSession,
} from './auth';

// AUDIT-2026-10-06: the login-code token (handed to whoever calls send-code,
// for any email) and the customer session token share a signing secret. Each
// verifier must only accept its own token type, or the code cookie doubles as
// a session for the requested email without the emailed code ever being used.
describe('token type separation', () => {
  it('rejects a login-code token presented as a customer session', async () => {
    const codeToken = await signCodeToken('victim@example.com', '123456');
    expect(await verifyCustomerSession(codeToken)).toBeNull();
  });

  it('rejects a customer session presented as a login-code token', async () => {
    const session = await signCustomerSession('customer@example.com', '111', 'Order 111');
    expect(await verifyCodeToken(session)).toBeNull();
  });

  it('still accepts each token where it belongs', async () => {
    const codeToken = await signCodeToken('a@example.com', '123456');
    expect(await verifyCodeToken(codeToken)).toMatchObject({ email: 'a@example.com', attempts: 0 });

    const session = await signCustomerSession('a@example.com', '111', 'Order 111');
    expect(await verifyCustomerSession(session)).toMatchObject({ email: 'a@example.com', orderId: '111', role: 'customer' });

    const impersonation = await signImpersonationSession('a@example.com', '111', 'Order 111', 'staff@summitsensory.com');
    expect(await verifyCustomerSession(impersonation)).toMatchObject({ impersonatedBy: 'staff@summitsensory.com' });
  });

  it('accepts a multi-order session with no orderId bound yet', async () => {
    const session = await signCustomerSession('a@example.com', undefined, undefined);
    expect(await verifyCustomerSession(session)).toMatchObject({ email: 'a@example.com', role: 'customer' });
  });

  it('rejects garbage and missing tokens', async () => {
    expect(await verifyCustomerSession(undefined)).toBeNull();
    expect(await verifyCustomerSession('not.a.jwt')).toBeNull();
    expect(await verifyCodeToken(undefined)).toBeNull();
  });
});
