import { describe, it, expect, vi } from 'vitest';
import { createSaveQueue } from '../../lib/saveQueue';

// Regression test for a real bug caught by independent verification
// (2026-09-21) in components/portal/ColorSelectionTab.js's handlePartChange:
// the revert-on-save-failure logic originally compared by VALUE ("is the
// current value still what I set it to?"), which fails a realistic
// sequence — pick A (save fails, still in flight) -> pick B -> pick A
// AGAIN — because the third call's value coincidentally equals the first
// (failed) call's own value, so the first call's stale catch handler wrongly
// reverts, and because the save queue reads its payload lazily, the
// already-queued saves for B and the second A then silently persist the
// wrong (reverted) value to the server as if successful, with no error
// shown.
//
// This file cannot render the real React component (no jsdom/@testing-
// library/react is installed in this repo — see this component's own
// header, no sibling test file exists for exactly this reason). Instead it
// replicates handlePartChange's actual state machine verbatim (same ref-
// based optimistic update, the same real createSaveQueue from
// lib/saveQueue.js, and the same generation-counter revert-gating logic) so
// the real concurrency primitive and the real algorithm are both exercised
// for real, not simulated. If handlePartChange's logic in the component
// ever drifts from this copy, this test stops proving anything about it —
// keep the two in sync.
function makeHarness(saveImpl) {
  const latestSelectionsRef = { current: {} };
  const partGenerationRef = { current: {} };
  const queue = createSaveQueue(saveImpl);
  const errors = [];

  async function handlePartChange(inputKey, part, value) {
    const previousValue = latestSelectionsRef.current[inputKey]?.[part];
    const partKey = `${inputKey}:${part}`;
    const myGeneration = (partGenerationRef.current[partKey] || 0) + 1;
    partGenerationRef.current[partKey] = myGeneration;
    const next = {
      ...latestSelectionsRef.current,
      [inputKey]: { ...latestSelectionsRef.current[inputKey], [part]: value },
    };
    latestSelectionsRef.current = next;
    try {
      await queue(() => ({ selections: latestSelectionsRef.current }));
    } catch (err) {
      const stillMostRecentCall = partGenerationRef.current[partKey] === myGeneration;
      if (stillMostRecentCall) {
        const reverted = {
          ...latestSelectionsRef.current,
          [inputKey]: { ...latestSelectionsRef.current[inputKey], [part]: previousValue },
        };
        latestSelectionsRef.current = reverted;
      }
      errors.push(err.message);
    }
  }

  return { handlePartChange, ref: latestSelectionsRef, errors };
}

describe('ColorSelectionTab handlePartChange revert logic — pick/re-pick race (2026-09-21 regression)', () => {
  it('picking A (save fails) -> B -> A again is NOT corrupted by the earlier failed A save reverting over the later, coincidentally-identical A pick', async () => {
    const saveImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network error')) // call 1: A fails
      .mockResolvedValueOnce(undefined)                    // call 2: B succeeds
      .mockResolvedValueOnce(undefined);                   // call 3: A again, succeeds

    const { handlePartChange, ref, errors } = makeHarness(saveImpl);

    // Fire all three in the exact order/timing that exposed the bug: call1
    // starts (and is in flight, will fail), call2 starts before call1's
    // catch runs, call3 (same value as call1) starts before call1's catch
    // runs too.
    const p1 = handlePartChange('legs', 'color', 'A');
    const p2 = handlePartChange('legs', 'color', 'B');
    const p3 = handlePartChange('legs', 'color', 'A');
    await Promise.all([p1, p2, p3]);

    // The customer's real last action was re-picking A, and the save for
    // it succeeded — the ref must reflect that, not be reverted to
    // undefined/null by the unrelated, older, already-failed first call.
    expect(ref.current.legs.color).toBe('A');
    // Exactly one error (the genuinely failed first save) was reported —
    // the second and third saves both succeeded and must not be silently
    // treated as failures or silently corrupted with no error shown.
    expect(errors).toEqual(['network error']);
  });

  it('a single failed save with no follow-up pick still reverts correctly (no regression on the simple case)', async () => {
    const saveImpl = vi.fn().mockRejectedValueOnce(new Error('network error'));
    const { handlePartChange, ref, errors } = makeHarness(saveImpl);

    await handlePartChange('legs', 'color', 'A');

    expect(ref.current.legs.color).toBeUndefined();
    expect(errors).toEqual(['network error']);
  });

  it('a newer, DIFFERENT pick made while an older save is still failing is preserved (the original 2026-09-09 fix still holds)', async () => {
    const saveImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network error')) // call 1: A fails
      .mockResolvedValueOnce(undefined);                   // call 2: B succeeds

    const { handlePartChange, ref, errors } = makeHarness(saveImpl);

    const p1 = handlePartChange('legs', 'color', 'A');
    const p2 = handlePartChange('legs', 'color', 'B');
    await Promise.all([p1, p2]);

    expect(ref.current.legs.color).toBe('B');
    expect(errors).toEqual(['network error']);
  });
});
