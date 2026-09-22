import { describe, it, expect } from 'vitest';
import { mergeProgress } from '../../../pages/portal/index';

// Regression tests for the 2026-09-21 audit finding: mergeProgress() used
// to only ever ADD a completion when Monday showed the checkmark, never
// CLEARING a stale localStorage-cached `true` when staff reverted Monday's
// own status column — so a customer reopening the portal on the same
// browser after staff reopened a step would still see it marked done, with
// no indication anything needed to be redone. Hoisted to module scope
// specifically so it can be tested directly (pure function, no closure over
// component state) rather than only indirectly through the full page.
describe('mergeProgress', () => {
  const allComplete = { contact: '✅', billing: '✅', delivery: '✅', colors: '✅', documents: '✅' };

  it('adds a completion Monday shows as done, even with no local cache at all', () => {
    const merged = mergeProgress({ progress: allComplete }, {});
    expect(merged).toEqual({ contact: true, billing: true, delivery: true, color: true, documents: true });
  });

  it('CLEARS a stale local completion when Monday no longer shows it as done — the actual fix', () => {
    // The exact real-world scenario: customer completed Billing on this
    // browser (cached true locally); staff later reverted the Monday
    // status column so the customer needs to redo it.
    const staleLocal = { billing: true };
    const merged = mergeProgress({ progress: { billing: 'Needs Rework' } }, staleLocal);
    expect(merged.billing).toBe(false);
  });

  it('Monday wins in BOTH directions across all 5 tabs, not just some', () => {
    const localCompletions = { contact: true, billing: false, delivery: true, color: false, documents: true };
    const mondayProgress = { contact: 'Needs Rework', billing: '✅', delivery: 'Needs Rework', colors: '✅', documents: 'Needs Rework' };
    const merged = mergeProgress({ progress: mondayProgress }, localCompletions);
    expect(merged).toEqual({ contact: false, billing: true, delivery: false, color: true, documents: false });
  });

  it('does not choke on a missing/undefined order or progress object', () => {
    expect(mergeProgress(undefined, { contact: true })).toEqual({
      contact: false, billing: false, delivery: false, color: false, documents: false,
    });
    expect(mergeProgress({}, {})).toEqual({
      contact: false, billing: false, delivery: false, color: false, documents: false,
    });
  });

  it('preserves an unrelated key in localCompletions that mergeProgress does not manage', () => {
    // Guards against a future change accidentally making this a strict
    // whitelist that silently drops something else the caller was tracking.
    const merged = mergeProgress({ progress: {} }, { someOtherFlag: true });
    expect(merged.someOtherFlag).toBe(true);
  });
});
