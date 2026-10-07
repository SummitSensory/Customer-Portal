// AUDIT-2026-10-06: bounce matching, the Resend webhook's internal-address
// guard, and the error-alert email budgets/skip prefix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendUrgentErrorAlert = vi.fn(() => Promise.resolve());
vi.mock('../../lib/email', () => ({ sendUrgentErrorAlert, sendInternalAlert: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

describe('hasBounced — whole-address matching', async () => {
  const { hasBounced, BOUNCE_TAG } = await import('../../lib/bounces.js');
  const note = (addr, tail = '') => ({ body: `[${BOUNCE_TAG}]\nEmail to ${addr} bounced on 10/6/2026 ("Reminder").${tail}` });

  it('matches the exact address, case-insensitively, including before sentence punctuation', () => {
    expect(hasBounced([note('Bob@X.org')], 'bob@x.org')).toBe(true);
    expect(hasBounced([{ body: `[${BOUNCE_TAG}]\nBounce for bob@x.org.` }], 'bob@x.org')).toBe(true);
    expect(hasBounced([{ body: `[${BOUNCE_TAG}]\n<a href="mailto:bob@x.org">bob@x.org</a>` }], 'bob@x.org')).toBe(true);
  });

  it('does not match a longer address that merely contains it', () => {
    expect(hasBounced([note('jbob@x.org')], 'bob@x.org')).toBe(false);
    expect(hasBounced([note('bob@x.org.uk')], 'bob@x.org')).toBe(false);
    expect(hasBounced([note('bob.smith@x.org')], 'smith@x.org')).toBe(false);
  });

  it('still finds the address when a longer lookalike appears first', () => {
    expect(hasBounced([{ body: `[${BOUNCE_TAG}]\njbob@x.org and bob@x.org both bounced` }], 'bob@x.org')).toBe(true);
  });

  it('ignores updates that are not bounce notes', () => {
    expect(hasBounced([{ body: 'bob@x.org asked a question' }], 'bob@x.org')).toBe(false);
  });
});

describe('Resend webhook — internal addresses', async () => {
  const { isInternalAddress } = await import('../../pages/api/resend/webhook.js');
  afterEach(() => vi.unstubAllEnvs());

  it('treats summitsensory.com addresses and the configured alert inboxes as internal', () => {
    vi.stubEnv('ALERT_EMAIL', 'alerts@example.net');
    expect(isInternalAddress('orders@summitsensory.com')).toBe(true);
    expect(isInternalAddress('Bryan@SummitSensory.com')).toBe(true);
    expect(isInternalAddress('portal@updates.summitsensory.com')).toBe(true);
    expect(isInternalAddress('alerts@example.net')).toBe(true);
    expect(isInternalAddress('teacher@school.org')).toBe(false);
    expect(isInternalAddress('x@notsummitsensory.com')).toBe(false);
  });
});

async function freshErrorAlerts() {
  vi.resetModules();
  return import('../../lib/errorAlerts');
}

describe('errorAlerts — separate budget for browser errors', () => {
  beforeEach(() => {
    sendUrgentErrorAlert.mockClear();
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('caps browser errors at their own budget, leaving the server budget intact', async () => {
    const { reportError } = await freshErrorAlerts();
    for (let i = 0; i < 40; i++) await reportError({ source: 'browser', message: `junk ${'x'.repeat(i)}`, budget: 'client' });
    expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(10);
    await reportError({ source: 'server', message: 'real server failure' });
    expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(11);
  });

  it('a browser report cannot use up a server error\'s dedupe slot', async () => {
    const { reportError } = await freshErrorAlerts();
    await reportError({ source: 'browser', message: 'Monday lookup error: timeout', budget: 'client' });
    await reportError({ source: 'server', message: 'Monday lookup error: timeout' });
    expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(2);
  });
});

describe('errorAlerts — reportCriticalFailure lines are not emailed twice', () => {
  beforeEach(() => {
    sendUrgentErrorAlert.mockClear();
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('skips monitoring\'s own [ALERT:…] log line but still emails a failed alert send', async () => {
    const realError = console.error;
    const flag = Symbol.for('summit.errorAlerts.installed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      delete globalThis[flag];
      const { installConsoleCapture } = await freshErrorAlerts();
      installConsoleCapture();
      console.error('[ALERT:cron/reminders] Reminders cron run failed.', { error: 'x' });
      expect(sendUrgentErrorAlert).not.toHaveBeenCalled();
      console.error('[ALERT-SEND-FAILED:cron/reminders] failed to send the alert email itself:', 'resend down');
      expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(1);
    } finally {
      console.error = realError;
      delete globalThis[flag];
      vi.restoreAllMocks();
    }
  });
});
