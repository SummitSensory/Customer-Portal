/**
 * POST /api/monday/status-balance-webhook
 *
 * EM-04: emails the customer when "Manufacturing Phase" (status__1) changes
 * to one of the customer-facing phases (lib/email.js CUSTOMER_STATUS_EMAILS),
 * whether the change was made in Monday or the Admin Portal. Internal phases
 * are ignored. (The file name predates 2026-10-06, when balance emails were
 * dropped — Bryan: no balance email needed.)
 *
 * Dedup: the Admin Portal path (orders.js) reacts to the same column write,
 * so both go through lib/monday.js's sendCustomerNotificationOnce() and its
 * "[PORTAL: Status Notified - X]" marker — whichever sends first wins. A
 * failed send isn't marked, and this answers 500 so Monday redelivers.
 *
 * Setup: a Monday webhook on board 6533700776 for changes to status__1 →
 *   https://portal.summitsensory.com/api/monday/status-balance-webhook?secret=<MONDAY_STATUS_WEBHOOK_SECRET>
 * Fails CLOSED if the secret env var is unset.
 */

import { getOrderById, sendCustomerNotificationOnce, COLS } from '../../../lib/monday';
import { notifyCustomerStatusChange, isCustomerFacingStatus } from '../../../lib/email';
import { secretsMatch } from '../../../lib/auth';
import { reportCriticalFailure } from '../../../lib/monitoring';

// Same three-location secret extraction as accessory-webhook.js — Monday's
// newer automation builder wants an Authentication field, not just a query
// param; accept whichever one it actually offers.
function extractProvidedSecret(req) {
  if (req.query.secret) return req.query.secret;
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length).trim();
  if (req.headers['x-webhook-secret']) return req.headers['x-webhook-secret'];
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday's webhook subscription flow occasionally re-verifies a URL by
  // POSTing a challenge — echo it straight back.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Fails CLOSED: an unset secret rejects rather than accepting anything.
  const secret = process.env.MONDAY_STATUS_WEBHOOK_SECRET;
  const provided = extractProvidedSecret(req);
  if (!secretsMatch(provided, secret)) {
    // A wrong secret is just a stray/probing request: log it, don't email
    // (lib/errorAlerts.js emails every console.error). A MISSING secret
    // means every real delivery is failing, so that still alerts.
    (process.env.MONDAY_STATUS_WEBHOOK_SECRET ? console.warn : console.error)('Monday status-balance-webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid secret.' });
  }

  const event = req.body?.event;
  const itemId = event?.pulseId;
  const columnId = event?.columnId;
  if (!itemId || !columnId) {
    // Not a column-change event we can act on — acknowledge so Monday
    // doesn't retry.
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const order = await getOrderById(itemId);
    if (!order?.customerEmail) {
      return res.status(200).json({ ok: true, skipped: 'No customer email on order.' });
    }

    // PORTAL-059: sendCustomerNotificationOnce() (lib/monday.js) replaces the
    // separate hasNotifiedValue()/markNotifiedValue() calls that used to live
    // here — see that function's own header comment for the race it closes
    // between this webhook and the Admin Portal PATCH path (orders.js), both
    // of which can react to the exact same Monday column write. `sendFn`
    // deliberately does NOT catch its own error here (matches this
    // endpoint's prior behavior): a failed send should NOT be marked
    // notified, so a later retry of this same automation can still succeed.
    if (columnId === COLS.status) {
      const status = order.status;
      if (!status || !status.trim()) {
        return res.status(200).json({ ok: true, skipped: 'No status value.' });
      }
      // Most phases are internal pipeline state — only a few are emailed.
      if (!isCustomerFacingStatus(status)) {
        return res.status(200).json({ ok: true, skipped: `"${status}" is not a customer-facing phase.` });
      }
      // Once the email has gone out, never answer 500: Monday would redeliver
      // and — with the "[PORTAL: Status Notified]" marker missing — the
      // customer would get the same email again on every retry (audit
      // 2026-10-09). The Resend idempotency key, keyed on Monday's own
      // triggerUuid (stable across its retries), is the second guard.
      let emailed = false;
      const triggerKey = event.triggerUuid ? `status/${itemId}/${event.triggerUuid}` : null;
      let result;
      try {
        result = await sendCustomerNotificationOnce(itemId, 'Status', status, async () => {
          await notifyCustomerStatusChange(order.customerEmail, order.contactName, order.name, status,
            triggerKey ? { idempotencyKey: triggerKey } : {});
          emailed = true;
        });
      } catch (err) {
        if (!emailed) throw err;
        await reportCriticalFailure(
          'monday/status-balance-webhook',
          `The "${status}" status email was sent to ${order.customerEmail} (order ${itemId}, "${order.name}") but the "[PORTAL: Status Notified - ${status}]" marker failed to save. Another change to this status (or the Admin Portal) may email the customer again — add an update on the order starting with exactly "[PORTAL: Status Notified - ${status}]" to prevent it.`,
          { itemId, status, error: err.message }
        );
        return res.status(200).json({ ok: true, notified: 'status', value: status, markFailed: true });
      }
      if (!result.sent) {
        return res.status(200).json({ ok: true, skipped: 'Already notified for this status.' });
      }
      return res.status(200).json({ ok: true, notified: 'status', value: status });
    }

    // Some other column on the board changed — not ours to react to.
    return res.status(200).json({ ok: true, skipped: 'Column not tracked.' });
  } catch (err) {
    console.error('Monday status-balance-webhook processing error:', err.message);
    // 500 so Monday redelivers (it retries for a bounded window, not
    // forever). Nothing was marked notified, so a retry sends the email
    // exactly once. This used to answer 200, which silently dropped any
    // status email whose send failed.
    return res.status(500).json({ ok: false, error: 'Processing error.' });
  }
}
