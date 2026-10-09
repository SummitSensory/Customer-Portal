/**
 * POST /api/resend/webhook
 * Resend → "email.bounced" / "email.complained" events.
 *
 * Until 2026-10-06 nothing in the portal noticed a bounce: Scarborough Public
 * Schools' invitation and every reminder bounced for a week and nobody knew
 * the customer had never received a portal email. Now each bounce/complaint:
 *   - is recorded on every order with that customer email as a
 *     "[PORTAL: Email Bounced]" update naming the address (lib/bounces.js),
 *     which stops reminders to it until staff fix the address, and
 *   - emails the team once so someone can get a working address.
 *
 * Setup: Resend → Webhooks → endpoint https://portal.summitsensory.com/api/resend/webhook,
 * events email.bounced + email.complained; put its signing secret (whsec_…)
 * in RESEND_WEBHOOK_SECRET. Requests are verified with Resend's Svix
 * signature scheme and rejected (fail closed) if the secret is unset.
 */

import crypto from 'crypto';
import { getOrderIdsByEmail, getOrderMessages, postTaggedUpdate } from '../../../lib/monday';
import { sendInternalAlert, isInternalAlertAddress } from '../../../lib/email';
import { BOUNCE_TAG, hasBounced } from '../../../lib/bounces';

export const config = { api: { bodyParser: false } };

const TOLERANCE_SECONDS = 5 * 60;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Svix signature check (the scheme Resend signs webhooks with). */
export function verifySvixSignature(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (!secret || !id || !timestamp || !signatures) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return String(signatures).split(' ').some(part => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);
  if (!verifySvixSignature(process.env.RESEND_WEBHOOK_SECRET, req.headers, rawBody)) {
    // A wrong secret is just a stray/probing request: log it, don't email
    // (lib/errorAlerts.js emails every console.error). A MISSING secret
    // means every real delivery is failing, so that still alerts.
    (process.env.RESEND_WEBHOOK_SECRET ? console.warn : console.error)('Resend webhook: signature verification failed (or RESEND_WEBHOOK_SECRET unset).');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }

  const kind = event?.type === 'email.bounced' ? 'bounced' : event?.type === 'email.complained' ? 'marked as spam' : null;
  if (!kind) return res.status(200).json({ skipped: `Event ${event?.type} not handled.` });

  const recipients = [].concat(event.data?.to || []).map(a => String(a).trim()).filter(Boolean);
  const subject = event.data?.subject || '';
  const reason = event.data?.bounce?.message || event.data?.bounce?.subType || '';

  try {
    for (const address of recipients) {
      // The alert would go to this same bouncing address and bounce again —
      // a loop. warn, not error: lib/errorAlerts.js emails every error, which
      // would also go to a bouncing alert inbox.
      if (isInternalAlertAddress(address)) {
        console.warn(`Resend webhook: internal alert address ${address} ${kind} ("${subject}") — not alerting about it (would loop).`);
        continue;
      }
      const orderIds = await getOrderIdsByEmail(address).catch(() => []);
      const newlyTagged = [];
      for (const id of orderIds) {
        const updates = await getOrderMessages(id).catch(() => []);
        if (hasBounced(updates, address)) continue; // already recorded — Resend redelivery or a later email
        await postTaggedUpdate(id, BOUNCE_TAG,
          `Email to ${address} ${kind} on ${new Date().toLocaleDateString()} ("${subject}")${reason ? ` — ${reason}` : ''}. Portal reminders to this address are paused. Fix the customer email on this order to resume them.`);
        newlyTagged.push(id);
      }
      // One team email per address, not one per later bounce.
      if (newlyTagged.length || !orderIds.length) {
        await sendInternalAlert(
          'resend/webhook',
          `Customer email ${address} ${kind} — they did not receive "${subject}".${orderIds.length ? ' Reminders to it are paused; please get a working address and update the order.' : ' No order uses this address.'}`,
          { orders: orderIds.join(', ') || 'none', reason: reason || 'n/a' }
        );
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Resend webhook: failed to record bounce:', err);
    return res.status(500).json({ error: 'Failed to record bounce.' });
  }
}
