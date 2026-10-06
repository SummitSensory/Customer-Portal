/**
 * POST /api/monday/update-webhook
 * Monday "When an update is created -> send a webhook" on the Manufacturing
 * Process board. Emails the customer when staff have replied to them in a way
 * they can see in their portal (see lib/replyNotify.js for exactly which
 * messages count — staff replies threaded under the customer's portal
 * messages, or Admin Portal posts the direct send missed).
 *
 * Setup: Integrations → Webhooks → "When a new update posted, send a webhook"
 *   URL: https://portal.summitsensory.com/api/monday/update-webhook?secret=<MONDAY_UPDATE_WEBHOOK_SECRET>
 *
 * The event is only used as a "something changed on item X" signal: the
 * item's message history is re-read and every not-yet-notified visible staff
 * message is covered by one email, deduped by message id. That means a
 * deleted update, an automation's log, an internal note, or the portal's own
 * tags can't trigger an email, and payload shape quirks (Monday's native
 * {event:{pulseId,...}} vs a flat {itemId} for manual testing) don't matter.
 *
 * Until 2026-10-06 this emailed ANY untagged update a staff account typed on
 * the order — internal notes included, which customers couldn't even see in
 * the portal.
 *
 * Always answers 200 once authenticated: Monday deactivates webhooks that
 * keep failing (it did to this one on 2026-08-18), and a failed send isn't
 * lost — nothing is marked, so cron/message-reply-safety-net retries it.
 *
 * PORTAL-003: requires ?secret= and fails CLOSED if the env var is unset.
 */

import { notifyPendingStaffReplies } from '../../../lib/replyNotify';
import { secretsMatch } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday.com sends a challenge on first setup — respond to verify
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Fails CLOSED: if the secret isn't configured, reject rather than accept
  // unauthenticated requests. Mirrors accessory-webhook.js.
  const secret = process.env.MONDAY_UPDATE_WEBHOOK_SECRET;
  if (!secretsMatch(req.query.secret, secret)) {
    console.error('Monday update-webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid secret.' });
  }

  const itemId = req.body?.event?.pulseId || req.body?.itemId;
  if (!itemId) return res.status(200).json({ skipped: 'No item id in payload.' });

  try {
    const result = await notifyPendingStaffReplies(itemId);
    if (!result.sent) return res.status(200).json({ skipped: result.skipped || 'No unnotified staff reply visible to the customer.' });
    return res.status(200).json({ ok: true, notified: result.ids });
  } catch (err) {
    console.error(`Update webhook: reply notification for item ${itemId} failed (the safety-net cron will retry):`, err);
    return res.status(200).json({ ok: false, retryBy: 'cron/message-reply-safety-net' });
  }
}
