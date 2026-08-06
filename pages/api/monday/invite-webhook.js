/**
 * POST /api/monday/invite-webhook?secret=...
 * Sends the customer portal invitation whenever a Monday item's invite-status
 * column (COLS.inviteStatus) is set to "Send Invite".
 *
 * Monday automation to configure:
 *   When [Invite Status] changes to "Send Invite",
 *   Send a webhook to: https://portal.summitsensory.com/api/monday/invite-webhook?secret=YOUR_SECRET
 *
 * Resendable by design: setting the status to "Send Invite" is itself a
 * deliberate action (not something that loops or fires on its own), so every
 * time it happens — first invite or a later resend because a customer lost
 * the email — this sends a fresh invitation. It used to silently skip any
 * order that already had a prior "[PORTAL: Invitation Sent]" tagged update,
 * which blocked intentional resends; removed 2026-08-06 per Bryan so staff
 * can just flip the status again any time a customer needs the email resent.
 * Each send is still logged to Monday (worded "Sent" vs "Resent" based on
 * whether a prior invite update exists) so there's a visible history either way.
 *
 * Env:
 *   MONDAY_INVITE_SECRET   shared secret in the webhook URL (falls back to CRON_SECRET)
 *   MONDAY_INVITE_SENT_LABEL   label to set after sending (default "Invite Sent")
 */

import {
  getOrderById,
  getOrderMessages,
  postTaggedUpdate,
  setStatusLabel,
} from '../../../lib/monday';
import { sendPortalInvitation } from '../../../lib/email';

const SECRET = process.env.MONDAY_INVITE_SECRET || process.env.CRON_SECRET || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday sends a challenge when the webhook is first connected — echo it back.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Verify the shared secret (from the URL ?secret= or an X-Webhook-Secret header).
  const provided = req.query.secret || req.headers['x-webhook-secret'];
  if (SECRET && provided !== SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  // Monday item id — supports a custom {itemId} body or the native event payload.
  const itemId = req.body?.itemId || req.body?.event?.pulseId;
  if (!itemId) return res.status(400).json({ error: 'No item id in payload.' });

  try {
    const order = await getOrderById(itemId);
    if (!order?.customerEmail) {
      return res.status(200).json({ skipped: 'Order has no customer email.' });
    }

    // Not a gate — just used to word the logged update as "Sent" vs "Resent"
    // so Monday's history stays clear about which this was.
    const updates = await getOrderMessages(itemId).catch(() => []);
    const isResend = updates.some(u => (u.body || '').includes('[PORTAL: Invitation Sent]'));

    await sendPortalInvitation(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name
    );

    await postTaggedUpdate(
      itemId,
      'PORTAL: Invitation Sent',
      `Portal invitation ${isResend ? 're-sent' : 'sent'} to ${order.customerEmail} on ${new Date().toLocaleDateString()} (triggered by Monday "Send Invite").`
    );

    // Flip the status back so the column reflects the latest send.
    await setStatusLabel(itemId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent').catch(() => {});

    return res.status(200).json({ ok: true, invited: order.customerEmail, resend: isResend });
  } catch (err) {
    console.error('Invite webhook error:', err);
    return res.status(500).json({ error: 'Failed to send invitation.' });
  }
}
