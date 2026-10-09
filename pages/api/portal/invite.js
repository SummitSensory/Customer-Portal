/**
 * POST /api/portal/invite
 * Sends a portal invitation email to a customer and logs the invite timestamp
 * to Monday.com as a tagged update.
 *
 * Body: { orderId }
 * Auth: staff (NextAuth session) only
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrderById, getOrderMessages, postTaggedUpdate, setStatusLabel } from '../../../lib/monday';
import { sendPortalInvitation } from '../../../lib/email';

const SENT_TAG = 'PORTAL: Invitation Sent';
// A second click within this window is treated as a double-click, not a
// deliberate resend (same window invite-webhook.js uses).
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const staffSession = await getServerSession(req, res, authOptions);
  if (!staffSession) return res.status(401).json({ error: 'Staff authentication required.' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  let order;
  try {
    order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
  } catch {
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  if (!order.customerEmail) {
    return res.status(400).json({ error: 'Order has no customer email address.' });
  }

  // Email send and Monday log write are handled as two distinct steps, not
  // one try/catch, so a log-write failure AFTER a successful send can't be
  // reported to staff as "Failed to send invitation." — that false negative
  // would prompt a resend, duplicating the customer email. The reminders
  // cron also starts its clock from this exact "PORTAL: Invitation Sent" tag
  // (see cron/reminders.js), so a failed log write is flagged loudly rather
  // than silently dropped.
  // Double-click guard (audit 2026-10-09): two quick clicks sent two
  // invitations. Skip when an invite was logged moments ago, and key the send
  // on the order + minute so two in-flight clicks collapse into one at Resend.
  try {
    const updates = await getOrderMessages(orderId);
    const since = Date.now() - DUPLICATE_WINDOW_MS;
    if (updates.some(u => (u.body || '').includes(`[${SENT_TAG}]`) && new Date(u.created_at).getTime() >= since)) {
      return res.status(200).json({ ok: true, skipped: 'An invitation was sent moments ago — not sending a duplicate.' });
    }
  } catch (err) {
    console.warn('Admin invite: duplicate check failed (sending anyway):', err.message);
  }

  let sent;
  try {
    sent = await sendPortalInvitation(
      order.customerEmail,
      order.firstName || order.pocName?.split(' ')[0] || '',
      order.name,
      { idempotencyKey: `portal-invite-admin/${orderId}/${Math.floor(Date.now() / 60000)}` }
    );
  } catch (err) {
    console.error('Invitation email error:', err);
    return res.status(500).json({ error: 'Failed to send invitation.' });
  }

  // Reflect the send on "Customer Portal Invite", like the Monday-triggered
  // path does — otherwise the board kept showing "TBD"/"Send Invite" and
  // invite-safety-net could flag an order that was in fact invited.
  await setStatusLabel(orderId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent')
    .catch(err => console.warn(`Admin invite: invite-status column flip failed for order ${orderId}:`, err.message));

  try {
    // Log invite timestamp to Monday.com for reminder tracking
    await postTaggedUpdate(
      orderId,
      SENT_TAG,
      `Portal invitation sent to ${order.customerEmail} by ${staffSession.user?.email || 'staff'} on ${new Date().toLocaleDateString()}.${sent?.id ? ` Email ID: ${sent.id}` : ''}`
    );
  } catch (err) {
    console.error(`Invitation email sent to ${order.customerEmail}, but the "PORTAL: Invitation Sent" log write FAILED for order ${orderId} — add it manually in Monday so the reminder cron's clock starts correctly:`, err.message);
    return res.status(200).json({ ok: true, warning: 'Invitation sent, but the internal log entry failed — reminder tracking may be affected.' });
  }

  return res.status(200).json({ ok: true });
}
