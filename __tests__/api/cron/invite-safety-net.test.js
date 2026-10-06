import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/monday', () => ({ getOrderSummaries: vi.fn(), getOrderMessages: vi.fn() }));
vi.mock('../../../lib/monitoring', () => ({ reportCriticalFailure: vi.fn() }));

const { needsInviteCheck, shouldAlertInviteGap } = await import('../../../pages/api/cron/invite-safety-net.js');

const NOW = new Date('2026-10-08T18:00:00Z');
const order = (over = {}) => ({ id: '1', name: 'Acme', customerEmail: 'a@school.org', status: 'Incoming Order', inviteStatus: '', createdAt: '2026-10-07T12:00:00Z', ...over });

// Paused 2026-09-18 after flagging 263 historical orders; re-enabled for
// orders created on/after 2026-10-06 only.
describe('needsInviteCheck', () => {
  it('checks a new live order past the grace period', () => {
    expect(needsInviteCheck(order(), NOW)).toBe(true);
  });

  it('never checks orders created before 10/6, whatever their phase', () => {
    expect(needsInviteCheck(order({ createdAt: '2026-10-05T23:00:00Z' }), NOW)).toBe(false);
    expect(needsInviteCheck(order({ createdAt: '2026-08-01T00:00:00Z', status: 'Shipped' }), NOW)).toBe(false);
  });

  it('skips pre-sales, cancelled and no-action phases, Do Not Send, and staff test orders', () => {
    for (const status of ['Wait to Push Order', 'ORDER CANCELLED', 'No Action Needed', '']) {
      expect(needsInviteCheck(order({ status }), NOW)).toBe(false);
    }
    expect(needsInviteCheck(order({ inviteStatus: 'Do Not Send' }), NOW)).toBe(false);
    expect(needsInviteCheck(order({ customerEmail: 'sales@summitsensory.com' }), NOW)).toBe(false);
  });

  it('waits out the 6-hour grace period', () => {
    expect(needsInviteCheck(order({ createdAt: '2026-10-08T14:00:00Z' }), NOW)).toBe(false);
  });
});

describe('shouldAlertInviteGap', () => {
  it('alerts on the first run after the grace period', () => {
    expect(shouldAlertInviteGap(order({ createdAt: '2026-10-08T08:00:00Z' }), NOW)).toBe(true); // 10h old
  });

  it('then only on the daily 12:00 UTC run', () => {
    const old = order({ createdAt: '2026-10-07T00:00:00Z' });
    expect(shouldAlertInviteGap(old, NOW)).toBe(false);
    expect(shouldAlertInviteGap(old, new Date('2026-10-08T12:00:00Z'))).toBe(true);
  });
});
