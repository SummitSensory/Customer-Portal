import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/monday', () => ({ mondayQuery: vi.fn() }));
const { encryptJson, decryptJson, qbString, authorizeUrl } = await import('../../lib/quickbooks');

beforeEach(() => {
  process.env.QBO_TOKEN_KEY = 'test-key-that-is-long-and-random';
  process.env.QBO_CLIENT_ID = 'client-123';
  process.env.NEXTAUTH_URL = 'https://portal.summitsensory.com';
});

describe('encrypted connection storage', () => {
  it('round-trips, and the stored text never contains the token', () => {
    const conn = { realmId: '123', refreshToken: 'RT-secret-value', accessToken: 'AT-secret' };
    const stored = encryptJson(conn);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('RT-secret-value');
    expect(decryptJson(stored)).toEqual(conn);
  });

  it('refuses text encrypted with a different key', () => {
    const stored = encryptJson({ refreshToken: 'x' });
    process.env.QBO_TOKEN_KEY = 'a-different-key';
    expect(() => decryptJson(stored)).toThrow();
  });

  it('treats an empty column as "not connected"', () => {
    expect(decryptJson('')).toBeNull();
  });
});

describe('qbString', () => {
  it("escapes quotes so a customer's name can't break the query", () => {
    expect(qbString("O'Brien Therapy")).toBe("'O\\'Brien Therapy'");
  });
});

describe('authorizeUrl', () => {
  it('asks for accounting access and returns to the portal callback', () => {
    const url = new URL(authorizeUrl('abc'));
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(url.searchParams.get('redirect_uri')).toBe('https://portal.summitsensory.com/api/admin/quickbooks/callback');
    expect(url.searchParams.get('state')).toBe('abc');
  });
});
