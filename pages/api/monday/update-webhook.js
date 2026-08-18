/**
 * POST /api/monday/update-webhook
 * Receives Monday.com automation webhook when a new update (reply) is posted
 * on an order item. If the reply is from a Summit staff member, emails the
 * customer to let them know there's a new message in their portal.
 *
 * Monday.com automation setup:
 *   Trigger: "When an update is created"
 *   Action:  "Send a webhook" → https://your-domain.vercel.app/api/monday/update-webhook?secret=<MONDAY_UPDATE_WEBHOOK_SECRET>
 *   JSON body: { "itemId": "{itemId}", "updateBody": "{updateBody}", "creatorEmail": "{creatorEmail}" }
 *
 * The automation fires for ALL updates (including customer ones). We only
 * email the customer when the update comes from a staff email domain.
 *
 * PORTAL-003: this endpoint previously had no authentication of any kind —
 * anyone who discovered the URL could POST an arbitrary itemId/creatorEmail
 * and trigger a customer notification email (or probe which itemIds exist
 * via the response). It now requires the same shared-secret query param
 * pattern used by accessory-webhook.js, and fails CLOSED if the secret env
 * var isn't configured.
 */

import { getOrderById, getOrderByEmail, setStatusLabel } from '../../../lib/monday';
import { sendCustomerReplyNotification } from '../../../lib/email';
import { isStaffEmail } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday.com sends a challenge on first setup — respond to verify
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Fails CLOSED: if the secret isn't configured, reject rather than accept
  // unauthenticated requests. Mirrors accessory-webhook.js.
  const secret = process.env.MONDAY_UPDATE_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    console.error('Monday update-webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid secret.' });
  }

  const { itemId, updateBody, creatorEmail } = req.body || {};
  if (!itemId || !creatorEmail) return res.status(400).json({ error: 'Missing fields.' });

  // Only notify customer when a staff member replied. Uses the shared
  // isStaffEmail() helper (lib/auth.js) rather than a locally duplicated
  // domain check — this file previously hardcoded a single fallback domain
  // (summitsensorygym.com) that didn't include summitsensory.com, so a staff
  // reply from an @summitsensory.com address (e.g. bryan@summitsensory.com)
  // would have been misclassified as a non-staff update whenever
  // STAFF_EMAIL_DOMAIN wasn't set in Vercel — found 2026-07-28 during a full
  // QA pass, alongside the Message Status automation gap (OPEN-3).
  const isStaff = isStaffEmail(creatorEmail);
  if (!isStaff) return res.status(200).json({ skipped: 'Non-staff update, no notification sent.' });

  try {
    // Staff replied — clear the messaging queue flag regardless of whether the
    // update was on-topic (a message reply) or something else staff-only; keeps
    // the "Message Status" column from getting stuck on "Needs Reply" if staff
    // reply to something unrelated to the portal Messages thread.
    await setStatusLabel(itemId, 'messageStatus', 'Replied').catch(() => {});

    const order = await getOrderById(itemId);
    if (!order?.customerEmail) return res.status(200).json({ skipped: 'No customer email on order.' });

    // Strip HTML and internal portal tags from the email preview
    const preview = (updateBody || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[PORTAL:[^\]]*\]/g, '') // remove [PORTAL: X] completion tags
      .replace(/^\[PORTAL\]\n?/m, '')    // remove bare [PORTAL] message prefix
      .trim()
      .slice(0, 280);

    if (!preview) return res.status(200).json({ skipped: 'Empty update body.' });

    await sendCustomerReplyNotification(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name,
      preview
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Update webhook error:', err);
    return res.status(500).json({ error: 'Notification failed.' });
  }
}
