/**
 * POST /api/monday/invite-webhook?secret=...
 * Auto-sends the customer portal invitation when a Monday item's invite-status
 * column (COLS.inviteStatus) is set to "Send Invite".
 *
 * Monday automation to configure:
 *   When [Invite Status] changes to "Send Invite",
 *   Send a webhook to: https://portal.summitsensory.com/api/monday/invite-webhook?secret=YOUR_SECRET
 *
 * Idempotent: skips if the order was already invited. On success it also flips
 * the status column to "Invite Sent" so it can't fire twice.
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

    // Idempotency — don't re-invite if we already have.
    const updates = await getOrderMessages(itemId).catch(() => []);
    const alreadyInvited = updates.some(u => (u.body || '').includes('[PORTAL: Invitation Sent]'));
    if (alreadyInvited) {
      // Still normalize the status so the trigger doesn't keep firing.
      await setStatusLabel(itemId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent').catch(() => {});
      return res.status(200).json({ skipped: 'Already invited.' });
    }

    await sendPortalInvitation(
      order.customerEmail,
      order.pocName || order.firstName || '',
      order.name
    );

    await postTaggedUpdate(
      itemId,
      'PORTAL: Invitation Sent',
      `Portal invitation auto-sent to ${order.customerEmail} on ${new Date().toLocaleDateString()} (triggered by Monday "Send Invite").`
    );

    // Flip the status so it won't fire again (label created if missing).
    await setStatusLabel(itemId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent').catch(() => {});

    return res.status(200).json({ ok: true, invited: order.customerEmail });
  } catch (err) {
    console.error('Invite webhook error:', err);
    return res.status(500).json({ error: 'Failed to send invitation.' });
  }
}
