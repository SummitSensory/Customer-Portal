/**
 * GET  /api/portal/color-selection — read the caller's saved selections +
 *                                     the required-input checklist for their order
 * POST /api/portal/color-selection — save one or more part/color choices,
 *                                     optionally confirming the whole input as complete
 *
 * Phase 1 scope: Structure & Frame Paint (Cardinal/Prismatic) and Mat & Pad
 * Color (vinyl), for the product types listed in lib/colorRequirements.js.
 * Every other product line keeps using the existing Jotform flow
 * (pages/api/jotform/webhook.js) unchanged until it migrates in a later
 * phase — see claude-project-docs's Color Selection Implementation Plan, §11.
 */

import { getOrderById, postTaggedUpdate, markSectionCompleteSafe, writeColorSelectionSnapshot } from '../../../lib/monday';
import { requiredColorInputs } from '../../../lib/colorRequirements';
import { validatePresentSelections, validateColorSelectionData, computeTotalUpcharge, sanitizeSelections } from '../../../lib/colorSelectionValidation';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { requireCustomerSession, loadSessionOrder, enforceRateLimit } from '../../../lib/apiAuth';
import { notifyTeamColorsConfirmed } from '../../../lib/email';
import { syncConfirmedColorsToBoards } from '../../../lib/colorBoardSync';

// A confirm now also writes the GB / R / Accessories rows (several Monday
// calls); give it room so a slow Monday response can't time the confirm out.
export const config = { maxDuration: 60 };

const BOARD_SYNC_DEADLINE_MS = 20_000;

function boardSyncEnabled() {
  const flag = (process.env.COLOR_BOARD_SYNC || '').toLowerCase();
  if (flag === 'off') return false;
  if (flag === 'on') return true;
  return process.env.VERCEL_ENV === 'production';
}

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms); }),
  ]);
}

// Real race found by independent code review (2026-09-09): the re-check-
// before-write below (added 2026-09-02/03) only ever catches a concurrent
// write that lands BEFORE ITS OWN verification read — a slower autosave
// that finishes its write AFTER a confirm has already re-checked, written,
// and verified can still land after all of that, silently overwriting the
// just-confirmed snapshot (writeColorSelectionSnapshot is a full,
// unconditional overwrite, not a per-field patch) and reverting
// confirmedAt back to null with no alert at all, since the confirm
// request's own verification already ran and matched before the autosave
// ever wrote.
//
// lib/concurrency.js (the existing shared concurrency helper in this
// codebase) only has mapWithConcurrency, a worker-pool limiter for cron
// loops — no mutex/lock primitive to reuse. Monday's API has no
// compare-and-swap (the same real platform constraint the comments below
// already document), so the only way to actually CLOSE this window rather
// than just narrow it is to make sure two requests for the SAME order can
// never run their read-validate-write sequence at the same time in the
// first place. orderRequestLocks is a small per-process mutex queue keyed
// by order id: whichever request's turn comes second is forced to do its
// own fresh confirmedAt read AFTER the first one's entire sequence
// (including its writes) has completed, so it correctly sees the
// now-confirmed state and gets rejected below instead of blindly
// overwriting it.
//
// Same honest limitation as everywhere else this codebase deals with
// Monday's lack of transactions: this is in-memory and per-process, so it
// only serializes requests actually handled by the same warm serverless
// instance — it does not (and cannot, without a real external lock service)
// serialize across separate instances. It closes the common, real-world
// case (a customer's own browser tab(s)/retries hitting the same warm
// function) without pretending to be a distributed lock this architecture
// was never going to have.
const orderRequestLocks = new Map(); // orderId -> Promise (tail of that order's queue)

function withOrderLock(orderId, fn) {
  const priorTail = orderRequestLocks.get(orderId) || Promise.resolve();
  // Run `fn` only after the previous request for this order has fully
  // settled — whether it succeeded or threw. Chaining onto BOTH branches
  // (not just the success one) means one failed request can never wedge
  // every later request for the same order behind a permanently-rejected
  // promise.
  const turn = priorTail.then(fn, fn);
  // The stored tail itself must never reject, for the same reason — it
  // only exists to sequence turns, not to propagate any one turn's result.
  const settled = turn.then(() => undefined, () => undefined);
  orderRequestLocks.set(orderId, settled);
  // Once this is genuinely the last queued turn for this order, drop the
  // map entry rather than leaking one forever per order that was ever
  // touched — an order with no in-flight requests should leave no trace.
  settled.then(() => {
    if (orderRequestLocks.get(orderId) === settled) orderRequestLocks.delete(orderId);
  });
  return turn;
}

// Re-exported for anything still importing these two from this file's own
// module (kept for the existing test suite's import paths) — the real
// implementations now live in lib/colorSelectionValidation.js, which has no
// auth/session/Monday dependency, specifically so pages/api/demo/color-
// selection.js can use the exact same validation without inheriting this
// file's NEXTAUTH_SECRET requirement (see that module's header comment for
// the real bug this fixes).
export { validateColorSelectionData, computeTotalUpcharge };

export default async function handler(req, res) {
  const session = await requireCustomerSession(req, res);
  if (!session) return;

  const order = await loadSessionOrder(session, res, { logPrefix: 'color-selection' });
  if (!order) return;

  if (req.method === 'GET') {
    const inputs = requiredColorInputs(order);
    return res.status(200).json({
      supported: !!inputs,
      requiredInputs: inputs || [],
      selections: order.colorSelectionSnapshot?.selections || {},
      confirmedAt: order.colorSelectionSnapshot?.confirmedAt || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Real gap found by independent code review (2026-09-02): every single
  // swatch click autosaves (see handlePartChange in ColorSelectionTab.js) —
  // unlike the other routes sharing lib/rateLimit.js's default (a form
  // submitted once, or an email-triggering action worth throttling hard), a
  // customer legitimately comparing colors across 131 Cardinal + 378
  // Prismatic options can easily click through more than 20 in a minute.
  // The 20/min default hitting a normal browsing session isn't a hardened
  // limit, it's a false positive that silently reverted the customer's last
  // pick with no retry. This route doesn't send email and can only ever
  // touch the caller's own order (session-bound), so a much higher ceiling
  // is safe here — still a real backstop against a runaway client loop,
  // just sized for how this specific endpoint is actually used.
  if (!enforceRateLimit(res, `color-selection:${session.email}`, { maxRequests: 100, windowMs: 60_000 })) return;

  // Locked the moment confirmedAt is set — matches what the customer was
  // told before they confirmed ("This Cannot Be Undone"). The picker UI
  // (ConfirmedView) already refuses to render an editable form once this is
  // true, but the client can't be trusted to enforce that alone: this is
  // the actual guarantee. No autosave, no re-confirm, no exceptions — a
  // customer who needs a change after confirming contacts staff, same as
  // any other locked portal field.
  if (order.colorSelectionSnapshot?.confirmedAt) {
    return res.status(409).json({
      error: 'Color selections were already confirmed and cannot be changed. Contact us if you need to make a correction.',
      confirmedAt: order.colorSelectionSnapshot.confirmedAt,
    });
  }

  const { selections, confirm } = req.body || {};
  if (!selections || typeof selections !== 'object') return res.status(400).json({ error: 'selections required.' });

  // Every present part is validated on every save, autosave included — an
  // invalid/wrong-category code is never accepted, priced, or persisted
  // regardless of confirm. Only COMPLETENESS (every required part present)
  // is confirm-gated, matching §09/§13 of the Experience doc (save early
  // and often; confirmation is the one moment that requires everything).
  const presentSelectionsError = validatePresentSelections(order, selections);
  if (presentSelectionsError) return res.status(400).json({ error: presentSelectionsError });

  if (confirm) {
    const validationError = validateColorSelectionData(order, selections);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  // Real gap found by independent code review (2026-09-02): validation above
  // only ever inspects the known input/part keys — it never rejects extra
  // top-level keys or oversized values a client might include alongside
  // them, and the whole `selections` object was persisted verbatim into
  // Monday's long-text snapshot column. Rebuilding a clean object here,
  // keeping only the exact {brand, code} shape for exactly the parts this
  // order's productType actually has, means nothing but that ever reaches
  // Monday regardless of what a request body actually contained.
  const cleanSelections = sanitizeSelections(order, selections);

  const totalUpcharge = computeTotalUpcharge(order, cleanSelections);
  const snapshot = {
    selections: cleanSelections,
    totalUpcharge,
    confirmedAt: confirm ? new Date().toISOString() : null,
  };

  // Everything from the fresh confirmedAt re-check through the write (and,
  // for confirm, the post-write verification + audit update + completion
  // sync) runs inside this order's lock — see withOrderLock above. That's
  // what actually closes the trailing-autosave-after-confirm race: this
  // request cannot even START its fresh read until any earlier request for
  // the SAME order has entirely finished, including its own write, so
  // there is no window left for a slower write to land after a faster
  // request already verified success.
  return withOrderLock(order.id, async () => {
    // Real race found by independent code review (2026-09-02): the
    // confirmedAt check above reads `order` from the top of this request —
    // there's no compare-and-swap on a Monday text column, so two requests
    // that both start before either write lands (two tabs, a duplicated/
    // retried request) can both pass that check. Re-reading immediately
    // before the write narrows that window down to the gap between this read
    // and the write itself, instead of the whole request's duration — as
    // close to atomic as this architecture allows. Combined with
    // withOrderLock above (2026-09-09): this fresh read can never itself run
    // concurrently with another request's write for this same order, so this
    // is now the actual, current state at the moment this request gets its
    // turn — not just "less stale."
    //
    // Runs for BOTH confirm and autosave (found in a later review pass,
    // 2026-09-03, that this was originally scoped to autosave only): two
    // concurrent CONFIRM requests (a double-click, two open tabs) both read
    // confirmedAt as null at the top of this handler and, without this
    // check applying to them too, would both proceed to write — a duplicate
    // "PORTAL: Color Selections" audit entry and a redundant completion-sync
    // call, with whichever write lands last silently winning. Re-checking
    // here closes that the same way it already does for autosave.
    let freshOrder;
    try {
      freshOrder = await getOrderById(order.id);
    } catch (err) {
      console.error('color-selection: re-check before save failed:', err.message);
      return res.status(500).json({ error: 'Error saving. Please try again.' });
    }
    if (freshOrder?.colorSelectionSnapshot?.confirmedAt) {
      return res.status(409).json({
        error: 'Color selections were already confirmed and cannot be changed. Contact us if you need to make a correction.',
        confirmedAt: freshOrder.colorSelectionSnapshot.confirmedAt,
      });
    }

    try {
      await writeColorSelectionSnapshot(order.id, snapshot);
    } catch (err) {
      console.error('color-selection: snapshot write failed:', err.message);
      return res.status(500).json({ error: 'Error saving. Please try again.' });
    }

    if (confirm) {
      // Decision (2026-09-03): Monday's API has no compare-and-swap on a text
      // column, so the re-check above narrows the confirm/autosave race to a
      // single read-then-write gap but can't eliminate it outright — a real,
      // permanent platform constraint, not something this app can code around.
      // What CAN be done is detect the rare case a race actually lands: read
      // back immediately after writing, and if what's now stored doesn't
      // match what this request just wrote, a different concurrent request's
      // write landed in between. This can't undo that (whichever write is
      // stored now is the real, final state — last-write-wins is an
      // acceptable resolution, not corruption), but it turns a silent,
      // invisible race into one staff are actively alerted to and can check.
      // With withOrderLock in place (2026-09-09) this should no longer be
      // reachable for a SAME-order race (that's now prevented, not just
      // detected) — this stays as a backstop for the one thing the lock
      // can't cover: a second process/instance for this same order, which an
      // in-memory, per-process lock can never serialize against.
      try {
        const verifyOrder = await getOrderById(order.id);
        const storedConfirmedAt = verifyOrder?.colorSelectionSnapshot?.confirmedAt;
        if (storedConfirmedAt !== snapshot.confirmedAt) {
          await reportCriticalFailure(
            'color-selection-confirm-race',
            `Order ${order.id}: two concurrent color-selection confirmations raced. This request wrote confirmedAt=${snapshot.confirmedAt}, but Monday now stores confirmedAt=${storedConfirmedAt} — a different request's write landed after this one. Worth a manual check that the stored selections are the intended final choice.`,
            { orderId: order.id, thisRequestConfirmedAt: snapshot.confirmedAt, storedConfirmedAt }
          );
        }
      } catch (err) {
        // A failed verification READ doesn't mean the write itself failed —
        // it already succeeded above. Log and move on rather than turning a
        // successful confirmation into an error response over this.
        console.error('color-selection: post-write race verification failed:', err.message);
      }

      // Real gap found by independent code review (2026-09-02): this used to
      // be `.catch(console.error)` — the one write in this whole confirm path
      // that could fail silently with no signal to staff at all, unlike
      // every other write here (which either fails the request or reports
      // via checklistSyncPending). The snapshot write and the completion
      // flag are the two things that actually matter to the customer/business
      // logic and have already succeeded by this point, so a failure here
      // must not turn a real, successful confirmation into an error response
      // — but staff still need to know the audit-trail update never landed,
      // via the same alerting path already used for other silent-failure
      // classes in this codebase (markSectionCompleteSafe, cron runs).
      let auditUpdatePending = false;
      try {
        await postTaggedUpdate(
          order.id,
          'PORTAL: Color Selections',
          `Customer confirmed color/finish selections on ${new Date().toLocaleDateString()}. Total upcharge: $${totalUpcharge}.`
        );
      } catch (err) {
        auditUpdatePending = true;
        await reportCriticalFailure(
          'color-selection-confirm',
          `Order ${order.id} confirmed color selections, but the audit-trail update to Monday failed.`,
          { orderId: order.id, error: err.message }
        );
      }

      // Staff email (with the upcharge up front) and the checklist flag come
      // FIRST — they are the billing signal and the customer-visible state, so
      // nothing slower (the board fill below) can ever keep them from landing.
      // Never fails the confirm; a failed email with money attached is escalated.
      await notifyTeamColorsConfirmed(order.name, session.email, totalUpcharge).catch(async (err) => {
        console.error('color-selection: confirm email failed:', err.message);
        if (totalUpcharge > 0) {
          await reportCriticalFailure('color-selection-confirm-email',
            `Order ${order.id} ("${order.name}") confirmed colors with a $${totalUpcharge} upcharge, but the staff email failed — add it to the invoice.`,
            { orderId: order.id, totalUpcharge, error: err.message });
        }
      });

      const synced = await markSectionCompleteSafe(order.id, 'portalColors');

      // Then fill the staff color boards (lib/colorBoardSync.js) so nobody
      // re-types these. Bounded, so a slow Monday can't time the confirm out;
      // anything that didn't land (or may have landed) is alerted. Only on
      // production unless deliberately switched on: Preview deployments share
      // the production Monday account, and a test confirm there would create
      // real GB/R rows — and R's "Received" automation starts a real
      // Production (R) item and emails its subscribers.
      if (boardSyncEnabled()) {
        let boardSync;
        try {
          boardSync = await withDeadline(
            syncConfirmedColorsToBoards(order, requiredColorInputs(order) || [], cleanSelections),
            BOARD_SYNC_DEADLINE_MS,
          );
        } catch (err) {
          boardSync = { boards: {}, errors: [err.message], skipped: [], notes: [] };
        }
        if (boardSync.errors.length || boardSync.notes?.length || boardSync.skipped?.length) {
          await reportCriticalFailure(
            boardSync.errors.length ? 'color-selection-board-sync' : 'color-selection-board-sync-notes',
            `Order ${order.id} ("${order.name}") confirmed colors. ${boardSync.errors.length ? `Writing them to the staff color boards did not finish cleanly (a row may or may not have been written — check before adding one by hand): ${boardSync.errors.join('; ')}. ` : ''}${[...(boardSync.notes || []), ...(boardSync.skipped || [])].join('; ')}. The picks are in the order's "Portal: Color Selection Answers (JSON)" column and the admin portal.`,
            { orderId: order.id, errors: boardSync.errors, notes: boardSync.notes, skipped: boardSync.skipped, boards: boardSync.boards });
        }
      }

      return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: !synced, auditUpdatePending });
    }

    return res.status(200).json({ ok: true, totalUpcharge, checklistSyncPending: false });
  });
}
