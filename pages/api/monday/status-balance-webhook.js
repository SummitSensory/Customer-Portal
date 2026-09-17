/**
 * POST /api/monday/status-balance-webhook
 *
 * Closes OPEN-1 (Customer-Portal-Process-Flow.md): EM-04 (order status
 * change) and EM-09 (balance update) previously fired ONLY when staff edited
 * an order through the Admin Portal (pages/api/monday/orders.js) — changing
 * Manufacturing Phase (DS-02) or the balance column directly in Monday.com
 * sent no customer email at all. This endpoint is the missing half: a Monday
 * automation ("When column changes -> send a webhook") on those two columns
 * fires this directly, regardless of where the edit was made.
 *
 * Dedup: the Admin Portal path and this webhook path can now both react to
 * the SAME Monday write (orders.js's updateOrderStatus()/updateBalance()
 * calls flip the exact columns this automation watches too), so without
 * dedup a staff edit made through the Admin Portal would email the customer
 * twice — once from orders.js, once a few seconds later from this webhook.
 * Both paths go through lib/monday.js's hasNotifiedValue()/markNotifiedValue(),
 * a tagged-update marker ("[PORTAL: Status Notified - X]" / "[PORTAL: Balance
 * Notified - X]") — whichever path sends first wins, the other sees the tag
 * and skips. Chosen over a new Monday column so this needs no board schema
 * change.
 *
 * One-time setup (Monday + Vercel):
 *   1. In Monday, add an automation on board 6533700776 ("Manufacturing
 *      Process"): "When Manufacturing Phase changes to anything -> send a
 *      webhook" -> this endpoint's URL. Same automation-builder flow already
 *      used for EP-22 (accessory-webhook.js) and EP-14 (update-webhook.js) —
 *      see OPEN-3's resolution notes for the exact steps if the builder
 *      needs a pre-authorized destination.
 *   2. Add a second automation, same board: "When [the balance column]
 *      changes -> send a webhook" -> the same URL. Only possible once
 *      MONDAY_COL_BALANCE is actually set (see DS-23 — unmapped by default).
 *      Skip this one until that column exists.
 *   3. Set MONDAY_STATUS_WEBHOOK_SECRET in Vercel and paste the same value
 *      into both automations' Authentication / query-param field.
 *
 * Until step 1/2 are done, this endpoint simply never receives traffic —
 * the Admin Portal path keeps working exactly as it does today.
 */

import { getOrderById, hasNotifiedValue, markNotifiedValue, COLS } from '../../../lib/monday';
import { notifyCustomerStatusChange, notifyCustomerBalanceChange } from '../../../lib/email';
import { secretsMatch } from '../../../lib/auth';

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
    console.error('Monday status-balance-webhook: authorization failed (missing or mismatched secret).');
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

    if (columnId === COLS.status) {
      const status = order.status;
      if (!status || !status.trim()) {
        return res.status(200).json({ ok: true, skipped: 'No status value.' });
      }
      if (await hasNotifiedValue(itemId, 'Status', status)) {
        return res.status(200).json({ ok: true, skipped: 'Already notified for this status.' });
      }
      await notifyCustomerStatusChange(order.customerEmail, order.contactName, order.name, status);
      await markNotifiedValue(itemId, 'Status', status);
      return res.status(200).json({ ok: true, notified: 'status', value: status });
    }

    if (COLS.balance && columnId === COLS.balance) {
      const balance = order.balance;
      if (balance === null || balance === undefined || Number.isNaN(balance)) {
        return res.status(200).json({ ok: true, skipped: 'No balance value.' });
      }
      const balanceKey = balance.toFixed(2);
      if (await hasNotifiedValue(itemId, 'Balance', balanceKey)) {
        return res.status(200).json({ ok: true, skipped: 'Already notified for this balance.' });
      }
      await notifyCustomerBalanceChange(order.customerEmail, order.contactName, order.name, balance);
      await markNotifiedValue(itemId, 'Balance', balanceKey);
      return res.status(200).json({ ok: true, notified: 'balance', value: balanceKey });
    }

    // Some other column on the board changed — not ours to react to.
    return res.status(200).json({ ok: true, skipped: 'Column not tracked.' });
  } catch (err) {
    console.error('Monday status-balance-webhook processing error:', err.message);
    // Still 200 — a transient error here shouldn't make Monday retry forever;
    // the Admin Portal path (if that's how this order gets edited next) will
    // still send the email correctly.
    return res.status(200).json({ ok: false, error: 'Processing error.' });
  }
}
