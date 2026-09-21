import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAllOrders = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monday', () => ({
  getAllOrders: (...args) => mockGetAllOrders(...args),
  getOrderMessages: (...args) => mockGetOrderMessages(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
}));

const mockSendSetupReminder = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  sendSetupReminder: (...args) => mockSendSetupReminder(...args),
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const { default: handler } = await import('../../../pages/api/cron/reminders.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function makeReq() {
  return { headers: { authorization: 'Bearer test-cron-secret' } };
}

const INCOMPLETE_PROGRESS = { contact: '✅', billing: '✅', delivery: '✅', colors: '✅', documents: '' };
const COMPLETE_PROGRESS = { contact: '✅', billing: '✅', delivery: '✅', colors: '✅', documents: '✅' };

function daysAgoISO(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function inviteUpdate(daysAgo) {
  return { body: '[PORTAL: Invitation Sent]', created_at: daysAgoISO(daysAgo) };
}

function reminderMarker(n, daysAgo) {
  return { body: `[PORTAL: Reminder #${n}] sent...`, created_at: daysAgoISO(daysAgo) };
}

describe('GET /api/cron/reminders', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, CRON_SECRET: 'test-cron-secret', REMINDER_INTERVAL_DAYS: '3', REMINDER_MAX_COUNT: '6' };
    mockGetAllOrders.mockReset();
    mockGetOrderMessages.mockReset();
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockSendSetupReminder.mockReset().mockResolvedValue(undefined);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
  });

  it('rejects a request with no/wrong CRON_SECRET configured (fail closed)', async () => {
    process.env.CRON_SECRET = '';
    const req = { headers: { authorization: 'Bearer whatever' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockGetAllOrders).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong bearer token', async () => {
    const req = { headers: { authorization: 'Bearer not-the-secret' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('skips an order that was never invited (no [PORTAL: Invitation Sent] marker)', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(res.body.reminded).toBe(0);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });

  it('skips an order whose setup is already fully complete', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: COMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(10)]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });

  it('skips an order that has already received the max number of reminders', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([
      inviteUpdate(30),
      ...Array.from({ length: 6 }, (_, i) => reminderMarker(i + 1, 30 - (i + 1) * 3)),
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });

  it('skips an order whose next reminder is not due yet', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    // Invited 1 day ago, no reminders yet — reminder #1 isn't due until day 3.
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(1)]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });

  it('reads completion from order.progress (durable Monday status columns), not free-text update bodies — the actual Kalen Siddens bug', async () => {
    // Contact was completed via the "edit and submit changes" path, which
    // posts "[PORTAL: Contact Update Requested]" — never the legacy exact
    // phrase this cron used to grep for — but order.progress.contact is
    // already '✅' since markSectionComplete flipped the real column.
    mockGetAllOrders.mockResolvedValue([{
      id: '1', customerEmail: 'kalen@example.com', name: 'Kalen Siddens',
      progress: { contact: '✅', billing: '', delivery: '', colors: '', documents: '' },
    }]);
    mockGetOrderMessages.mockResolvedValue([
      inviteUpdate(5),
      { body: '[PORTAL: Contact Update Requested]', created_at: daysAgoISO(4) },
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockSendSetupReminder).toHaveBeenCalledTimes(1);
    const [, , , incompleteLabels] = mockSendSetupReminder.mock.calls[0];
    expect(incompleteLabels).not.toContain('Contact Information');
    expect(incompleteLabels).toContain('Billing Information');
  });

  it('sends a due reminder and logs the marker to prevent a duplicate on the next run', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', firstName: 'Alex', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockSendSetupReminder).toHaveBeenCalledWith('a@b.com', 'Alex', 'Order A', expect.arrayContaining(['Required Documents']), 1);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('1', 'PORTAL: Reminder #1', expect.any(String));
    expect(res.body.reminded).toBe(1);
    expect(res.body.errors).toBe(0);
  });

  // Regression test for the dup-send fix: previously the send and the
  // marker-write shared one try/catch, so a marker-write failure AFTER a
  // successful send was indistinguishable from a send failure — both just
  // logged and incremented results.errors, meaning the next scheduled run
  // would find no marker and re-send an IDENTICAL reminder email. The fix
  // splits them into separate try/catches: a marker-write failure after a
  // successful send must still count as reminded (the email really did go
  // out) and must alert a human via reportCriticalFailure, not silently
  // become a retryable "error".
  it('a marker-write failure AFTER a successful send does not get treated as a retryable error (would otherwise duplicate-send)', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);
    mockPostTaggedUpdate.mockRejectedValue(new Error('Monday API unavailable'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockSendSetupReminder).toHaveBeenCalledTimes(1);
    expect(res.body.reminded).toBe(1);
    expect(res.body.errors).toBe(0);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'cron/reminders',
      expect.stringContaining('RE-SEND'),
      expect.objectContaining({ orderId: '1', reminderNumber: 1 })
    );
  });

  it('a send failure (nothing went out) counts as an error, not reminded, and does not attempt the marker write', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);
    mockSendSetupReminder.mockRejectedValue(new Error('Resend API down'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.reminded).toBe(0);
    expect(res.body.errors).toBe(1);
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
  });

  it('alerts when every attempted reminder failed (systemic issue), but stays quiet on a normal quiet day of only skips', async () => {
    mockGetAllOrders.mockResolvedValue([
      { id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS },
      { id: '2', customerEmail: 'b@b.com', name: 'Order B', progress: INCOMPLETE_PROGRESS },
    ]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);
    mockSendSetupReminder.mockRejectedValue(new Error('Resend API key revoked'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.reminded).toBe(0);
    expect(res.body.errors).toBe(2);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'cron/reminders',
      expect.stringContaining('every attempted reminder failed'),
      expect.anything()
    );
  });

  it('does not alert on a quiet day where every order was simply skipped', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: COMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(10)]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });

  it('reports and returns 500 when the run fails before completing (e.g. getAllOrders throws)', async () => {
    mockGetAllOrders.mockRejectedValue(new Error('Monday board unreachable'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'cron/reminders',
      expect.stringContaining('failed before completing'),
      expect.anything()
    );
  });
});
