import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/monday', () => ({ getOrderSummaries: vi.fn(), getOrderMessages: vi.fn() }));
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: vi.fn() }));

const { shouldAlertGap, firstEligibleAt } = await import('../../../pages/api/cron/message-reply-safety-net.js');

// One stuck gap used to re-alert every 30-minute run for days (153 emails,
// 2026-10-02 → 10-05). It should alert on the first run that sees it, then
// only on the daily reminder run.
// AUDIT-2026-10-06: "first run" is now the one :00/:30 slot that could first
// act on the message — the old "under 60 minutes old" test matched two runs.
describe('shouldAlertGap', () => {
  const at = (iso) => new Date(iso);

  it('alerts on exactly one run: the first slot after the message became eligible', () => {
    const eligible = at('2026-10-06T02:41:00Z');
    expect(shouldAlertGap(eligible, at('2026-10-06T03:00:04Z'))).toBe(true); // first run that can see it (a few seconds late is fine)
    expect(shouldAlertGap(eligible, at('2026-10-06T03:30:02Z'))).toBe(false); // the old rule alerted here too
    expect(shouldAlertGap(eligible, at('2026-10-06T04:00:00Z'))).toBe(false);
  });

  it('a message landing exactly on a slot boundary alerts on that run only', () => {
    const eligible = at('2026-10-06T03:00:00Z');
    expect(shouldAlertGap(eligible, at('2026-10-06T03:00:01Z'))).toBe(true);
    expect(shouldAlertGap(eligible, at('2026-10-06T03:30:01Z'))).toBe(false);
  });

  it('stays quiet on later runs outside the daily reminder window', () => {
    const old = at('2026-10-05T20:00:00Z');
    expect(shouldAlertGap(old, at('2026-10-06T03:00:00Z'))).toBe(false);
    expect(shouldAlertGap(old, at('2026-10-06T14:30:00Z'))).toBe(false);
    expect(shouldAlertGap(old, at('2026-10-06T13:59:00Z'))).toBe(false);
  });

  it('re-alerts an old gap once a day, on the 14:00 UTC run', () => {
    const old = at('2026-10-04T20:00:00Z');
    expect(shouldAlertGap(old, at('2026-10-06T14:00:30Z'))).toBe(true);
    expect(shouldAlertGap(old, at('2026-10-06T14:29:00Z'))).toBe(true);
  });
});

describe('firstEligibleAt', () => {
  it('adds the Admin Portal grace period for top-level staff posts only', () => {
    expect(firstEligibleAt({ kind: 'message', created_at: '2026-10-06T02:55:00Z' }).toISOString()).toBe('2026-10-06T03:05:00.000Z');
    expect(firstEligibleAt({ kind: 'reply', created_at: '2026-10-06T02:55:00Z' }).toISOString()).toBe('2026-10-06T02:55:00.000Z');
  });

  it('so an Admin Portal post skipped by the 03:00 run (inside its grace period) alerts on the 03:30 run', () => {
    const eligible = firstEligibleAt({ kind: 'message', created_at: '2026-10-06T02:55:00Z' });
    expect(shouldAlertGap(eligible, new Date('2026-10-06T03:00:00Z'))).toBe(false);
    expect(shouldAlertGap(eligible, new Date('2026-10-06T03:30:00Z'))).toBe(true);
    expect(shouldAlertGap(eligible, new Date('2026-10-06T04:00:00Z'))).toBe(false);
  });
});
