/**
 * Serializes async calls so only one is ever in flight at a time, and each
 * queued call reads its payload lazily — via a getter, called only once
 * it's actually its turn to run — rather than capturing a value at the
 * moment it was enqueued.
 *
 * Exists to fix a real bug found in review of the color-selection picker
 * (components/portal/ColorSelectionTab.js): every save sends a full
 * selection snapshot (the API replaces, not patches — see
 * pages/api/portal/color-selection.js). Without this, two saves triggered
 * in quick succession (a fast double-click, or a slow network) could
 * resolve out of order, letting an older, smaller snapshot silently
 * overwrite a newer one on the server. Reading the payload lazily at run
 * time — not at enqueue time — is what actually fixes it: even a save
 * enqueued first will pick up any change made while it was waiting its
 * turn.
 */
export function createSaveQueue(runFn) {
  let chain = Promise.resolve();
  return function enqueue(getPayload) {
    const run = chain.then(() => runFn(getPayload()));
    // One failed call must not permanently wedge every call queued after
    // it — the caller of enqueue() still sees/handles that call's own
    // rejection via the returned promise.
    chain = run.catch(() => {});
    return run;
  };
}
