// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  saveSetup, readJsonSafely, friendlySaveError, ORDER_MISMATCH_MESSAGE,
  validateTaxCertificateFile, TAX_CERT_MAX_BYTES,
  countUnreadStaffMessages, latestMessageTimestamp, completionAppliesTo,
} from '../../../pages/portal/index';

// AUDIT-2026-10-06 regression coverage for pages/portal/index.js.

function textResponse(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

describe('saveSetup — orderId + defensive error parsing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the orderId the form was rendered for alongside tab/data', async () => {
    const fetchMock = vi.fn(async () => textResponse(200, JSON.stringify({ ok: true, checklistSyncPending: false })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await saveSetup('billing', { a: 1 }, 'order-7');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tab: 'billing', data: { a: 1 }, orderId: 'order-7' });
    expect(result).toEqual({ ok: true, checklistSyncPending: false });
  });

  it('a 409 ORDER_MISMATCH throws the reload message with status/code attached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(409, JSON.stringify({ error: 'x', code: 'ORDER_MISMATCH' }))));
    await expect(saveSetup('contact', {}, 'o1')).rejects.toMatchObject({ message: ORDER_MISMATCH_MESSAGE, status: 409, code: 'ORDER_MISMATCH' });
  });

  it("a non-JSON Vercel 413 body never surfaces a raw 'Unexpected token' parser error", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(413, 'Request Entity Too Large')));
    const err = await saveSetup('tax_exemption', {}, 'o1').catch((e) => e);
    expect(err.message).toMatch(/too large/i);
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  it('a non-JSON 504 gets a friendly timeout message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(504, '<html>An error occurred</html>')));
    const err = await saveSetup('delivery', {}, 'o1').catch((e) => e);
    expect(err.message).toMatch(/took too long/);
  });

  it('a JSON validation error keeps the server message', () => {
    expect(friendlySaveError(400, { error: 'State is required.' })).toBe('State is required.');
  });

  it('readJsonSafely returns null (not a throw) for a non-JSON body', async () => {
    expect(await readJsonSafely(textResponse(500, 'oops'))).toBeNull();
  });
});

describe('validateTaxCertificateFile', () => {
  const f = (name, type, size) => ({ name, type, size });
  it('accepts PDF/JPEG/PNG/HEIC under 3 MB', () => {
    expect(validateTaxCertificateFile(f('a.pdf', 'application/pdf', 1000))).toBeNull();
    expect(validateTaxCertificateFile(f('a.jpg', 'image/jpeg', 1000))).toBeNull();
    expect(validateTaxCertificateFile(f('a.png', 'image/png', 1000))).toBeNull();
    expect(validateTaxCertificateFile(f('a.heic', 'image/heic', 1000))).toBeNull();
    expect(validateTaxCertificateFile(f('a.HEIC', '', 1000))).toBeNull(); // browsers that report no type
  });
  it('rejects files over the limit with a size message', () => {
    expect(validateTaxCertificateFile(f('a.pdf', 'application/pdf', TAX_CERT_MAX_BYTES + 1))).toMatch(/maximum is 3 MB/);
  });
  it('rejects other types', () => {
    expect(validateTaxCertificateFile(f('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10))).toMatch(/PDF, JPEG, PNG, or HEIC/);
  });
});

describe('Messages badge — unread staff messages since last seen', () => {
  const staffEmail = { email: 'team@summitsensory.com' };
  const msgs = [
    { id: '1', body: '[PORTAL][PORTAL:STAFF]hi', created_at: '2026-10-01T10:00:00Z', replies: [] },
    { id: '2', body: '[PORTAL][PORTAL:CUSTOMER]question', created_at: '2026-10-02T10:00:00Z', replies: [
      { id: '2r', creator: staffEmail, created_at: '2026-10-03T10:00:00Z' },
    ] },
    { id: '3', body: '[PORTAL: Reminder #2] not chat', creator: staffEmail, created_at: '2026-10-04T10:00:00Z' },
  ];

  it('counts staff messages AND threaded staff replies, never customer or audit-trail updates', () => {
    expect(countUnreadStaffMessages(msgs, 0)).toBe(2);
  });

  it('clears once seen — only items newer than the last-seen timestamp count', () => {
    expect(countUnreadStaffMessages(msgs, Date.parse('2026-10-02T00:00:00Z'))).toBe(1);
    expect(countUnreadStaffMessages(msgs, latestMessageTimestamp(msgs))).toBe(0);
  });
});

describe('markComplete stale-save guard', () => {
  it('only applies a completion to the order the save was for, if it is still active', () => {
    expect(completionAppliesTo('A', 'A')).toBe(true);
    expect(completionAppliesTo('A', 'B')).toBe(false); // save for A resolved after switching to B
    expect(completionAppliesTo(undefined, undefined)).toBe(false); // never a summit_setup_undefined write
  });
});
