import { describe, it, expect, vi } from 'vitest';
import { createSaveQueue } from './saveQueue';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createSaveQueue', () => {
  it('runs calls in enqueue order, never overlapping', async () => {
    const order = [];
    const d1 = deferred();
    const d2 = deferred();
    const runFn = vi.fn((payload) => {
      order.push(`start:${payload}`);
      return (payload === 'first' ? d1.promise : d2.promise).then(() => order.push(`end:${payload}`));
    });
    const enqueue = createSaveQueue(runFn);

    const p1 = enqueue(() => 'first');
    const p2 = enqueue(() => 'second');

    // "second" must not start until "first" has resolved, even though both
    // were enqueued before either resolved.
    await Promise.resolve(); // let the queue's microtasks settle
    expect(order).toEqual(['start:first']);

    d1.resolve();
    await p1;
    await Promise.resolve();
    expect(order).toEqual(['start:first', 'end:first', 'start:second']);

    d2.resolve();
    await p2;
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('reads the payload lazily — a value changed after enqueue but before the call runs is what actually gets sent', async () => {
    const d1 = deferred();
    const runFn = vi.fn((payload) => (payload === 'blocker' ? d1.promise : Promise.resolve(payload)));
    const enqueue = createSaveQueue(runFn);

    let latest = 'stale-value-at-enqueue-time';
    enqueue(() => 'blocker'); // holds the queue open
    const p2 = enqueue(() => latest); // enqueued while latest is still stale

    latest = 'fresh-value-by-the-time-it-actually-runs'; // simulates a change arriving before its turn
    d1.resolve();
    const result = await p2;

    expect(result).toBe('fresh-value-by-the-time-it-actually-runs');
  });

  it('a rejected call does not wedge the queue for calls after it', async () => {
    const runFn = vi.fn((payload) => (payload === 'fails' ? Promise.reject(new Error('boom')) : Promise.resolve(payload)));
    const enqueue = createSaveQueue(runFn);

    const p1 = enqueue(() => 'fails');
    const p2 = enqueue(() => 'succeeds');

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('succeeds');
  });

  it('a single call resolves normally (the common case — no contention)', async () => {
    const runFn = vi.fn((payload) => Promise.resolve(`ok:${payload}`));
    const enqueue = createSaveQueue(runFn);
    await expect(enqueue(() => 'x')).resolves.toBe('ok:x');
  });
});
