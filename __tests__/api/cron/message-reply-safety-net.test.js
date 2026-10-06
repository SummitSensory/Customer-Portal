import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/monday', () => ({ getOrderSummaries: vi.fn(), getOrderMessages: vi.fn() }));
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: vi.fn() }));

const { shouldAlertGap } = await import('../../../pages/api/cron/message-reply-safety-net.js');

// One stuck gap used to re-alert every 30-minute run for days (153 emails,
// 2026-10-02 → 10-05). It should alert on the first run that sees it, then
// only on the daily reminder run.
describe('shouldAlertGap', () => {
  const at = (iso) => new Date(iso);

  it('alerts on the first run that sees the gap (reply 30–60 minutes old)', () => {
    expect(shouldAlertGap(31, at('2026-10-06T03:00:00Z'))).toBe(true);
    expect(shouldAlertGap(59.9, at('2026-10-06T03:00:00Z'))).toBe(true);
  });

  it('stays quiet on later runs outside the daily reminder window', () => {
    expect(shouldAlertGap(60, at('2026-10-06T03:00:00Z'))).toBe(false);
    expect(shouldAlertGap(600, at('2026-10-06T14:30:00Z'))).toBe(false);
    expect(shouldAlertGap(600, at('2026-10-06T13:59:00Z'))).toBe(false);
  });

  it('re-alerts an old gap once a day, on the 14:00 UTC run', () => {
    expect(shouldAlertGap(3000, at('2026-10-06T14:00:30Z'))).toBe(true);
    expect(shouldAlertGap(3000, at('2026-10-06T14:29:00Z'))).toBe(true);
  });
});
