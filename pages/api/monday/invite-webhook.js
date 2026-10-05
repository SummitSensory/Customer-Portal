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
 * Manual resend (2026-09-28): the same endpoint also handles the separate
 * "Manually Send Invite" column (COLS.manualInvite). A second Monday automation:
 *   When [Manually Send Invite] changes to "Manually Send Invite",
 *   Send a webhook to: (the same URL as above)
 * sends the exact same invitation, regardless of any earlier send, then flips
 * THAT column to "Manually Sent Invite" (the "Customer Portal Invite" column is
 * left alone). Which column fired is read from Monday's event.columnId.
 *
 * Env:
 *   MONDAY_INVITE_SECRET   shared secret in the webhook URL — required, no fallback
 *   MONDAY_INVITE_SENT_LABEL   label to set after sending (default "Invite Sent")
 *   MONDAY_MANUAL_INVITE_SENT_LABEL   same, for the manual column (default "Manually Sent Invite")
 *
 * PORTAL-012: this used to fall back to CRON_SECRET when MONDAY_INVITE_SECRET
 * was unset, and skipped verification entirely if BOTH were unset — either
 * condition let anyone who found this URL trigger a real invitation email to
 * a customer, or (with the CRON_SECRET fallback) meant compromising this
 * endpoint's secret also compromised the unrelated cron-auth secret. This
 * endpoint now requires its own dedicated secret and fails closed if unset.
 */

import {
  COLS,
  deleteUpdate,
  getOrderById,
  getOrderIdsByEmail,
  getOrderMessages,
  postTaggedUpdate,
  setStatusLabel,
} from '../../../lib/monday';
import { sendPortalInvitation } from '../../../lib/email';
import { secretsMatch } from '../../../lib/auth';

const SENT_TAG = 'PORTAL: Invitation Sent';
const CLAIM_TAG = 'PORTAL: Invitation Claim';
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday sends a challenge when the webhook is first connected — echo it back.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Verify the shared secret (from the URL ?secret= or an X-Webhook-Secret header).
  // Fails CLOSED: if MONDAY_INVITE_SECRET isn't configured, reject rather
  // than accept unauthenticated requests.
  const secret = process.env.MONDAY_INVITE_SECRET;
  const provided = req.query.secret || req.headers['x-webhook-secret'];
  if (!secretsMatch(provided, secret)) {
    console.error('Monday invite-webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  // Monday item id — supports a custom {itemId} body or the native event payload.
  const itemId = req.body?.itemId || req.body?.event?.pulseId;
  if (!itemId) return res.status(400).json({ error: 'No item id in payload.' });

  const manual = !!COLS.manualInvite && req.body?.event?.columnId === COLS.manualInvite;
  const trigger = manual ? 'Manually Send Invite' : 'Send Invite';
  // Only the one label sends — so flipping the column to "Manually Sent Invite"
  // (below) or "Do Not Send" can't send again if the automation is set to fire
  // on any change of the column.
  const label = req.body?.event?.value?.label?.text;
  if (manual && label && label !== 'Manually Send Invite') {
    return res.status(200).json({ skipped: `Column changed to "${label}", not "Manually Send Invite".` });
  }

  let claim = null;
  const releaseClaim = async () => {
    if (claim?.id) await deleteUpdate(claim.id).catch(() => {});
  };

  try {
    const order = await getOrderById(itemId);
    if (!order?.customerEmail) {
      return res.status(200).json({ skipped: 'Order has no customer email.' });
    }

    // Duplicate guard. Monday fires the "Manufacturing Phase → Incoming Order"
    // automation twice when an order is created already at Incoming Order, so
    // every new customer got the invite twice, ~1s apart (6 customers,
    // 2026-09-24 → 09-28). Each request posts a claim, then re-reads: only the
    // earliest claim sends, and nothing sends if an invite already went out in
    // the last DUPLICATE_WINDOW_MS. A deliberate resend minutes later is
    // unaffected.
    //
    // The guard spans every order with this customer's email, not just this
    // one: Box Butte General Hospital has two Monday orders created seconds
    // apart, and each sent its own invitation to the same person 4s apart
    // (2026-10-01). Monday update ids increase across the whole account, so
    // "earliest claim wins" works across orders too. One login covers all of
    // a customer's orders, so one invitation is all they need; the other
    // orders get an "Invitation Sent" note (their reminder clock still starts).
    // A failed claim write doesn't block the send — it only loses the guard.
    claim = await postTaggedUpdate(itemId, CLAIM_TAG, `Sending the portal invitation (Monday "${trigger}")…`).catch(() => null);
    const self = String(itemId);
    const siblingIds = await Promise.resolve().then(() => getOrderIdsByEmail(order.customerEmail)).catch(() => []);
    const ids = [...new Set([self, ...siblingIds.map(String)])];
    const histories = await Promise.all(ids.map(id =>
      getOrderMessages(id).then(list => list.map(u => ({ ...u, itemId: id }))).catch(() => [])
    ));
    const updates = histories[0];
    const all = histories.flat();
    const since = Date.now() - DUPLICATE_WINDOW_MS;
    const recent = (tag) => all.filter(u => (u.body || '').includes(`[${tag}]`) && new Date(u.created_at).getTime() >= since);
    const firstClaim = recent(CLAIM_TAG).sort((a, b) => Number(a.id) - Number(b.id))[0];
    const recentSent = recent(SENT_TAG);
    const lostClaim = !!(firstClaim && claim?.id && String(firstClaim.id) !== String(claim.id));
    if (recentSent.length || lostClaim) {
      await releaseClaim();
      const ownSent = recentSent.some(u => u.itemId === self);
      const coveredBy = recentSent.find(u => u.itemId !== self) || (lostClaim && firstClaim.itemId !== self ? firstClaim : null);
      if (coveredBy && !ownSent) {
        await postTaggedUpdate(
          itemId,
          SENT_TAG,
          `No separate email — ${order.customerEmail} was sent the portal invitation moments ago for another of their orders (Monday item ${coveredBy.itemId}). One login covers all of their orders.`
        ).catch(() => {});
        if (manual) {
          await setStatusLabel(itemId, 'manualInvite', process.env.MONDAY_MANUAL_INVITE_SENT_LABEL || 'Manually Sent Invite').catch(() => {});
        } else {
          await setStatusLabel(itemId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent').catch(() => {});
        }
        return res.status(200).json({ skipped: 'Covered by the invitation just sent for another order with this customer email.', coveredBy: coveredBy.itemId });
      }
      return res.status(200).json({ skipped: 'Duplicate trigger — this invitation was already sent (or is being sent) moments ago.' });
    }

    // Not a gate — just used to word the logged update as "Sent" vs "Resent"
    // so Monday's history stays clear about which this was.
    const isResend = updates.some(u => (u.body || '').includes(`[${SENT_TAG}]`));

    const sent = await sendPortalInvitation(
      order.customerEmail,
      order.firstName || order.pocName?.split(' ')[0] || '',
      order.name
    );

    await postTaggedUpdate(
      itemId,
      SENT_TAG,
      `Portal invitation ${isResend ? 're-sent' : 'sent'} to ${order.customerEmail} on ${new Date().toLocaleDateString()} (triggered by Monday "${trigger}").${sent?.id ? ` Email ID: ${sent.id}` : ''}`
    );

    // Flip the triggering column so it reflects the latest send.
    if (manual) {
      await setStatusLabel(itemId, 'manualInvite', process.env.MONDAY_MANUAL_INVITE_SENT_LABEL || 'Manually Sent Invite').catch(() => {});
    } else {
      await setStatusLabel(itemId, 'inviteStatus', process.env.MONDAY_INVITE_SENT_LABEL || 'Invite Sent').catch(() => {});
    }

    await releaseClaim();
    return res.status(200).json({ ok: true, invited: order.customerEmail, resend: isResend, manual });
  } catch (err) {
    await releaseClaim();
    console.error('Invite webhook error:', err);
    return res.status(500).json({ error: 'Failed to send invitation.' });
  }
}
