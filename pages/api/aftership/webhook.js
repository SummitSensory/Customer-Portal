/**
 * POST /api/aftership/webhook
 *
 * Receives AfterShip tracking-update webhooks and handles two boards:
 *
 * 1. Therapy Equipment & Accessories — mirrors the live carrier status onto
 *    the matching subitem's "Carrier Status" column on Monday (staff-facing
 *    only, no customer email).
 *
 * 2. Sensory Gym Frame / Therapy Mats & Padding (main Manufacturing Process
 *    board) — if the customer has turned on "Freight Email Alerts" in their
 *    portal, emails them on the meaningful status changes (In Transit, Out
 *    for Delivery, Delivered, Exception). Deduped per shipment via the
 *    "Frame/Mats Last Notified Status" columns so repeat checkpoints with the
 *    same tag don't re-send.
 *
 * One-time setup required in the AfterShip dashboard (Developers → Webhooks):
 *   URL: https://portal.summitsensory.com/api/aftership/webhook
 *
 * AfterShip's current webhook UI has no plain "secret" field — auth is done
 * via a custom header instead. Add one custom header on the webhook named
 * `x-webhook-secret` whose value matches AFTERSHIP_WEBHOOK_SECRET in Vercel's
 * env vars; verified below (constant-time compare) before anything else runs.
 * Older AfterShip accounts that DO sign requests with HMAC-SHA256 in an
 * `aftership-hmac-sha256` header are also supported as a fallback.
 */

import crypto from 'crypto';
import {
  findAccessorySubitemByTracking,
  updateAccessoryCarrierStatus,
  findOrderByFreightTracking,
  updateFreightNotifyTag,
} from '../../../lib/monday';
import { labelForTag, publicUrl } from '../../../lib/aftership';
import { notifyCustomerFreightUpdate } from '../../../lib/email';

// Only these carrier statuses are worth emailing a customer about — skip the
// noisy/early ones (Pending, InfoReceived) that don't tell them anything new.
const NOTIFY_WORTHY_TAGS = new Set(['InTransit', 'OutForDelivery', 'Delivered', 'Exception']);
const SHIPMENT_LABELS = { frame: 'Sensory Gym Frame', mats: 'Therapy Mats & Padding' };

// Needed for the HMAC fallback path, which must sign the exact raw bytes.
export const config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function timingSafeStringEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function isValidSignature(rawBody, signature) {
  const secret = process.env.AFTERSHIP_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false; // length mismatch, malformed header, etc.
  }
}

function isAuthorized(req, rawBody) {
  const secret = process.env.AFTERSHIP_WEBHOOK_SECRET;
  if (!secret) return false;

  // Preferred: plain shared-secret custom header (current AfterShip webhook UI).
  const headerSecret = req.headers['x-webhook-secret'];
  if (headerSecret && timingSafeStringEqual(headerSecret, secret)) return true;

  // Fallback: HMAC-signed body (older AfterShip accounts).
  const signature = req.headers['aftership-hmac-sha256'];
  if (signature && isValidSignature(rawBody, signature)) return true;

  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);

  if (!isAuthorized(req, rawBody)) {
    console.error('AfterShip webhook: authorization failed.');
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // AfterShip's tracking-update payload nests the shipment under `msg`
  // (current format). `data.tracking` is an older/alternate shape kept as a
  // fallback — it's unconfirmed whether any currently-active AfterShip
  // account still sends it. If neither matches we fall back to the raw
  // payload itself; log which shape we actually used so a genuinely new
  // AfterShip payload format shows up in logs instead of silently no-op'ing.
  let t;
  let shapeUsed;
  if (payload?.msg) { t = payload.msg; shapeUsed = 'msg'; }
  else if (payload?.data?.tracking) { t = payload.data.tracking; shapeUsed = 'data.tracking'; }
  else { t = payload; shapeUsed = 'raw'; }

  const slug = t?.slug;
  const trackingNumber = t?.tracking_number;
  const tag = t?.tag;

  if (!slug || !trackingNumber || !tag) {
    console.warn(`AfterShip webhook: could not extract slug/tracking_number/tag (shape tried: ${shapeUsed}). Top-level payload keys: ${Object.keys(payload || {}).join(', ') || '(none)'}`);
    // Not a shipment status event — acknowledge so AfterShip doesn't retry.
    return res.status(200).json({ ok: true, skipped: true });
  }
  if (shapeUsed === 'raw') {
    console.warn('AfterShip webhook: payload matched neither the "msg" nor "data.tracking" shape, but slug/tracking_number/tag were present at the top level — verify this really is a shipment-update event.');
  }

  try {
    // 1. Therapy Equipment & Accessories — Monday-board-only sync (no customer email).
    const subitem = await findAccessorySubitemByTracking(slug, trackingNumber);
    if (subitem) {
      await updateAccessoryCarrierStatus(subitem.id, labelForTag(tag));
      return res.status(200).json({ ok: true, matched: true, board: 'accessories', subitemId: subitem.id });
    }

    // 2. Sensory Gym Frame / Therapy Mats & Padding — customer-facing email,
    // gated on their opt-in preference and deduped against the last tag sent.
    const order = await findOrderByFreightTracking(slug, trackingNumber);
    if (!order) {
      // Not one of ours at all.
      return res.status(200).json({ ok: true, matched: false });
    }

    if (!NOTIFY_WORTHY_TAGS.has(tag)) {
      return res.status(200).json({ ok: true, matched: true, board: 'freight', skipped: 'Tag not notify-worthy.' });
    }
    if (!order.freightNotifyEnabled) {
      return res.status(200).json({ ok: true, matched: true, board: 'freight', skipped: 'Customer has not opted in.' });
    }
    if (!order.customerEmail) {
      return res.status(200).json({ ok: true, matched: true, board: 'freight', skipped: 'No customer email on order.' });
    }
    const statusLabel = labelForTag(tag);
    if (order.lastNotifiedTag === statusLabel) {
      return res.status(200).json({ ok: true, matched: true, board: 'freight', skipped: 'Already notified for this status.' });
    }

    // Send + dedupe-tag-write are handled as two distinct steps (not both
    // inside one try/catch) so a failure in one can't be silently confused
    // with the other. If the email send itself fails, skip the tag write —
    // we want the next checkpoint/retry to try sending again rather than
    // mark this status "notified" when the customer never got it. If the
    // tag write fails AFTER a successful send, that's a different, less bad
    // failure (worst case: one duplicate email on the next matching
    // checkpoint) — log it loudly rather than let the outer catch (which
    // still returns 200) swallow it silently.
    try {
      await notifyCustomerFreightUpdate(
        order.customerEmail,
        order.contactName,
        order.orderName,
        SHIPMENT_LABELS[order.shipmentKey] || 'Shipment',
        statusLabel,
        publicUrl(slug, trackingNumber)
      );
    } catch (err) {
      console.error(`AfterShip webhook: failed to send freight update email for order ${order.itemId} (${order.shipmentKey} -> "${statusLabel}"):`, err.message);
      return res.status(200).json({ ok: false, matched: true, board: 'freight', error: 'Failed to send customer email.' });
    }

    try {
      await updateFreightNotifyTag(order.itemId, order.shipmentKey, statusLabel);
    } catch (err) {
      console.error(`AfterShip webhook: email sent but the dedupe tag write FAILED for order ${order.itemId} (${order.shipmentKey} -> "${statusLabel}") — set "${order.shipmentKey === 'frame' ? 'Frame' : 'Mats'} Last Notified Status" manually in Monday to prevent a duplicate email on the next matching checkpoint:`, err.message);
    }

    return res.status(200).json({ ok: true, matched: true, board: 'freight', notified: order.customerEmail });
  } catch (err) {
    console.error('AfterShip webhook processing error:', err.message);
    // Still 200 — a transient error on our side shouldn't make AfterShip retry
    // forever; the shipment's next status change will sync on its own.
    return res.status(200).json({ ok: false, error: 'Processing error.' });
  }
}
