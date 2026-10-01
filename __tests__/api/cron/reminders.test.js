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
const mockNotifyExhausted = vi.fn().mockResolvedValue({ id: 'team-1' });
const mockSendCombined = vi.fn().mockResolvedValue({ id: 'combined-1' });
vi.mock('../../../lib/email', () => ({
  sendCombinedSetupReminder: (...args) => mockSendCombined(...args),
  sendSetupReminder: (...args) => mockSendSetupReminder(...args),
  notifyTeamRemindersExhausted: (...args) => mockNotifyExhausted(...args),
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const { default: handler, reminderDecision } = await import('../../../pages/api/cron/reminders.js');

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
    process.env = { ...OLD_ENV, CRON_SECRET: 'test-cron-secret', REMINDER_INTERVAL_DAYS: '3', REMINDER_MAX_COUNT: '6',
      JOTFORM_FORM_MAP: JSON.stringify({ 111: { tab: 'required_documents', name: 'W-9' } }) };
    mockGetAllOrders.mockReset();
    mockGetOrderMessages.mockReset();
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockSendSetupReminder.mockReset().mockResolvedValue(undefined);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
    mockNotifyExhausted.mockReset().mockResolvedValue({ id: 'team-1' });
    mockSendCombined.mockReset().mockResolvedValue({ id: 'combined-1' });
  });

  it('two orders for the same customer due the same day get ONE email, and both orders are marked', async () => {
    mockGetAllOrders.mockResolvedValue([
      { id: '1', customerEmail: 'gbehling@bbgh.org', name: 'Box Butte (A)', progress: INCOMPLETE_PROGRESS },
      { id: '2', customerEmail: 'GBehling@bbgh.org', name: 'Box Butte (B)', progress: INCOMPLETE_PROGRESS },
    ]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockSendSetupReminder).not.toHaveBeenCalled();
    expect(mockSendCombined).toHaveBeenCalledTimes(1);
    const [, , orders, number] = mockSendCombined.mock.calls[0];
    expect(orders.map((o) => o.name).sort()).toEqual(['Box Butte (A)', 'Box Butte (B)']);
    expect(number).toBe(1);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('1', 'PORTAL: Reminder #1', expect.stringContaining('One email covered 2 orders'));
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('2', 'PORTAL: Reminder #1', expect.stringContaining('Email ID: combined-1'));
    expect(res.body.reminded).toBe(2);
  });

  it('a failed combined send counts an error per order and writes no markers', async () => {
    mockGetAllOrders.mockResolvedValue([
      { id: '1', customerEmail: 'x@y.org', name: 'A', progress: INCOMPLETE_PROGRESS },
      { id: '2', customerEmail: 'x@y.org', name: 'B', progress: INCOMPLETE_PROGRESS },
    ]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);
    mockSendCombined.mockRejectedValue(new Error('Resend down'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.errors).toBe(2);
    expect(res.body.reminded).toBe(0);
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
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
    // No Monday history read for a completed order (these reads were timing out).
    expect(mockGetOrderMessages).not.toHaveBeenCalled();
  });

  it('skips an order at the max that staff were already told about', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([
      inviteUpdate(30),
      ...Array.from({ length: 6 }, (_, i) => reminderMarker(i + 1, 30 - (i + 1) * 3)),
      { body: '[PORTAL: Reminders Exhausted] ...', created_at: daysAgoISO(9) },
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
    expect(mockNotifyExhausted).not.toHaveBeenCalled();
  });

  it('an order that used every reminder is reported to staff once, in one email per run, and marked', async () => {
    const capped = (id, name) => ({ id, customerEmail: id + '@b.com', name, progress: INCOMPLETE_PROGRESS });
    mockGetAllOrders.mockResolvedValue([capped('1', 'Order A'), capped('2', 'Order B')]);
    mockGetOrderMessages.mockResolvedValue([
      inviteUpdate(30),
      ...Array.from({ length: 6 }, (_, i) => reminderMarker(i + 1, 30 - (i + 1) * 3)),
    ]);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockSendSetupReminder).not.toHaveBeenCalled();
    expect(mockNotifyExhausted).toHaveBeenCalledTimes(1);
    expect(mockNotifyExhausted.mock.calls[0][0].map((o) => o.name).sort()).toEqual(['Order A', 'Order B']);
    expect(mockNotifyExhausted.mock.calls[0][0][0].incomplete).toEqual(['Required Documents']);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('1', 'PORTAL: Reminders Exhausted', expect.stringContaining('Re-send the portal invitation'));
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('2', 'PORTAL: Reminders Exhausted', expect.any(String));
    expect(res.body.exhausted).toBe(2);
  });

  it('if the staff email fails, no exhausted markers are written (so the next run retries)', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([
      inviteUpdate(30),
      ...Array.from({ length: 6 }, (_, i) => reminderMarker(i + 1, 30 - (i + 1) * 3)),
    ]);
    mockNotifyExhausted.mockRejectedValue(new Error('Resend down'));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
    expect(res.body.exhausted).toBe(0);
    expect(res.body.errors).toBe(1);
  });

  it('logs the email provider id on the reminder marker', async () => {
    mockGetAllOrders.mockResolvedValue([{ id: '1', customerEmail: 'a@b.com', name: 'Order A', progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(3)]);
    mockSendSetupReminder.mockResolvedValue({ id: 'resend-abc' });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('1', 'PORTAL: Reminder #1', expect.stringContaining('Email ID: resend-abc'));
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
  // 2026-09-28 audit: customers were told their order was on hold for steps
  // that were N/A, had nothing to do, or that staff had already handled.
  it("treats an N/A step as done (no reminder when every step is N/A or ✅)", async () => {
    const naProgress = { contact: "N/A", billing: "✅", delivery: "N/A", colors: "N/A", documents: "N/A" };
    mockGetAllOrders.mockResolvedValue([{ id: "1", customerEmail: "a@b.com", name: "Order A", progress: naProgress }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(30)]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
    expect(mockGetOrderMessages).not.toHaveBeenCalled();
  });

  it("stops reminding once the order is past setup (e.g. GB Fab Details Sent, Shipped)", async () => {
    mockGetAllOrders.mockResolvedValue([
      { id: "1", customerEmail: "a@b.com", name: "A", status: "GB Fab Details Sent", progress: INCOMPLETE_PROGRESS },
      { id: "2", customerEmail: "c@d.com", name: "B", status: "Shipped", progress: INCOMPLETE_PROGRESS },
    ]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(30)]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toBe(2);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });

  it("still reminds while the order is waiting on the customer (e.g. Incoming Order)", async () => {
    mockGetAllOrders.mockResolvedValue([{ id: "1", customerEmail: "a@b.com", name: "A", status: "Incoming Order", progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(4)]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.reminded).toBe(1);
    expect(mockSendSetupReminder.mock.calls[0][3]).toEqual(["Required Documents"]);
  });

  it("does not ask for Required Documents when no document form applies to the product", async () => {
    process.env.JOTFORM_FORM_MAP = JSON.stringify({ 111: { tab: "required_documents", productTypes: ["Therapy Mats & Pads"] } });
    mockGetAllOrders.mockResolvedValue([{ id: "1", customerEmail: "a@b.com", name: "A", productType: "Other", progress: INCOMPLETE_PROGRESS }]);
    mockGetOrderMessages.mockResolvedValue([inviteUpdate(4)]);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.body.skipped).toBe(1);
    expect(mockSendSetupReminder).not.toHaveBeenCalled();
  });
});

describe('reminderDecision', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const invite = (iso) => ({ created_at: iso, body: '[PORTAL: Invitation Sent] ...' });
  const reminder = (n, iso) => ({ created_at: iso, body: '[PORTAL: Reminder #' + n + '] ...' });

  // Brighton Central School District's real history (2026-08-14 -> 2026-10-01).
  const brighton = [
    invite('2026-10-01T15:14:00Z'),
    reminder(6, '2026-09-02T14:00:51Z'), reminder(5, '2026-08-31T14:01:26Z'),
    reminder(4, '2026-08-27T14:01:39Z'), reminder(3, '2026-08-25T14:01:01Z'),
    reminder(2, '2026-08-24T14:01:44Z'), reminder(1, '2026-08-18T14:01:21Z'),
    invite('2026-08-14T17:59:47Z'),
  ];

  it('a re-sent invitation restarts the cycle (Brighton: re-invited 10/1 after capping out 9/2)', () => {
    expect(reminderDecision(brighton, new Date('2026-10-02T14:00:00Z'), 3, 6)).toEqual({ action: 'wait' });
    expect(reminderDecision(brighton, new Date('2026-10-05T14:00:00Z'), 3, 6)).toEqual({ action: 'send', number: 1 });
  });

  it('before the re-invite, Brighton was capped out (and now gets reported, not silently dropped)', () => {
    const before = brighton.slice(1);
    expect(reminderDecision(before, new Date('2026-09-07T14:00:00Z'), 3, 6)).toEqual({ action: 'exhausted' });
  });

  it('spaces each reminder from the previous one, not from the invite', () => {
    // Invite 20 days ago, reminder #1 one day ago: the old N x interval rule
    // said #2 was long overdue and sent it immediately.
    const now = new Date('2026-10-01T14:00:00Z');
    const u = [invite(new Date(now - 20 * DAY).toISOString()), reminder(1, new Date(now - 1 * DAY).toISOString())];
    expect(reminderDecision(u, now, 3, 6)).toEqual({ action: 'wait' });
    expect(reminderDecision(u, new Date(now.getTime() + 2 * DAY), 3, 6)).toEqual({ action: 'send', number: 2 });
  });

  it('a reminder logged a minute after the previous 14:00 run is still due at the 14:00 run three days later', () => {
    const u = [invite('2026-09-25T10:00:00Z'), reminder(1, '2026-09-28T14:01:30Z')];
    expect(reminderDecision(u, new Date('2026-10-01T14:00:00Z'), 3, 6)).toEqual({ action: 'send', number: 2 });
  });

  it('at the cap: waits out the interval, then reports once', () => {
    const days = [3, 6, 9, 12, 15, 18];
    const u = [invite('2026-09-01T00:00:00Z'), ...days.map((d, i) => reminder(i + 1, '2026-09-' + String(d).padStart(2, '0') + 'T14:00:00Z'))];
    expect(reminderDecision(u, new Date('2026-09-19T14:00:00Z'), 3, 6)).toEqual({ action: 'wait' });
    expect(reminderDecision(u, new Date('2026-09-21T14:00:00Z'), 3, 6)).toEqual({ action: 'exhausted' });
    const reported = [...u, { created_at: '2026-09-21T14:05:00Z', body: '[PORTAL: Reminders Exhausted] ...' }];
    expect(reminderDecision(reported, new Date('2026-09-30T14:00:00Z'), 3, 6)).toEqual({ action: 'escalated' });
  });

  it('no invitation -> nothing to do', () => {
    expect(reminderDecision([reminder(1, '2026-09-01T00:00:00Z')], new Date(), 3, 6)).toEqual({ action: 'no-invite' });
  });
});
