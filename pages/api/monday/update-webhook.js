/**
 * POST /api/monday/update-webhook
 * Receives Monday.com automation webhook when a new update (reply) is posted
 * on an order item. If the reply is from a Summit staff member, emails the
 * customer to let them know there's a new message in their portal.
 *
 * Monday.com automation setup:
 *   Trigger: "When an update is created"
 *   Action:  "Send a webhook" → https://your-domain.vercel.app/api/monday/update-webhook
 *   JSON body: { "itemId": "{itemId}", "updateBody": "{updateBody}", "creatorEmail": "{creatorEmail}" }
 *
 * The automation fires for ALL updates (including customer ones). We only
 * email the customer when the update comes from a staff email domain.
 */

import { getOrderById, getOrderByEmail } from '../../../lib/monday';
import { sendCustomerReplyNotification } from '../../../lib/email';

const STAFF_DOMAIN = process.env.STAFF_EMAIL_DOMAIN || 'summitsensorygym.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday.com sends a challenge on first setup — respond to verify
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const { itemId, updateBody, creatorEmail } = req.body || {};
  if (!itemId || !creatorEmail) return res.status(400).json({ error: 'Missing fields.' });

  // Only notify customer when a staff member replied
  const isStaff = creatorEmail.toLowerCase().endsWith(`@${STAFF_DOMAIN}`);
  if (!isStaff) return res.status(200).json({ skipped: 'Non-staff update, no notification sent.' });

  try {
    const order = await getOrderById(itemId);
    if (!order?.customerEmail) return res.status(200).json({ skipped: 'No customer email on order.' });

    // Strip HTML tags for the email preview
    const preview = (updateBody || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[PORTAL:.*?\]/g, '') // remove internal tags
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
