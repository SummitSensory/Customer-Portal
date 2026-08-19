/**
 * Small worker-pool concurrency limiter.
 *
 * The cron jobs (reminders.js, accessory-tracking-sync.js) used to process
 * every order/item one at a time with a plain `for...of` + `await` loop —
 * correct, but it means total run time scales linearly with the number of
 * orders/items, and a board with hundreds of rows risks bumping into
 * Vercel's function-duration limit. `mapWithConcurrency` runs up to `limit`
 * calls to `fn` at once instead of one, while still respecting Monday's and
 * AfterShip's rate limits by capping how many run concurrently (unlike a
 * bare `Promise.all(items.map(fn))`, which would fire every call at once).
 *
 * This only helps I/O-bound work (network calls) — JS itself is single
 * threaded, so `fn` calls interleave on the event loop rather than running
 * on separate cores. That's exactly the case here: these loops spend nearly
 * all their time waiting on Monday/AfterShip API responses, not computing.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
