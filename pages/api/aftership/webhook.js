/**
 * POST /api/aftership/webhook
 *
 * Receives AfterShip tracking-update webhooks and mirrors the live carrier
 * status onto the matching Therapy Equipment & Accessories subitem's
 * "Carrier Status" column on Monday — so staff see In Transit / Out for
 * Delivery / Delivered / Exception on the board itself, not just in the
 * portal (which already shows live status on demand via /api/aftership/track).
 *
 * One-time setup required in the AfterShip dashboard (Settings → Webhooks):
 *   URL:    https://portal.summitsensory.com/api/aftership/webhook
 *   Secret: also set as AFTERSHIP_WEBHOOK_SECRET in Vercel env vars
 *
 * AfterShip signs the raw request body with HMAC-SHA256 (base64) in the
 * `aftership-hmac-sha256` header. Verified below before anything is processed.
 * Only shipments tracked via the Therapy Equipment & Accessories board are
 * acted on — Frame/Mats tracking numbers are safely ignored (no match found).
 */

import crypto from 'crypto';
import { findAccessorySubitemByTracking, updateAccessoryCarrierStatus } from '../../../lib/monday';
import { labelForTag } from '../../../lib/aftership';

// Signature verification needs the exact raw bytes AfterShip signed, so the
// default JSON body parser must be disabled.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);
  const signature = req.headers['aftership-hmac-sha256'];

  if (!isValidSignature(rawBody, signature)) {
    console.error('AfterShip webhook: signature verification failed.');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // AfterShip's tracking-update payload nests the shipment under `msg`.
  const t = payload?.msg || payload?.data?.tracking || payload;
  const slug = t?.slug;
  const trackingNumber = t?.tracking_number;
  const tag = t?.tag;

  if (!slug || !trackingNumber || !tag) {
    // Not a shipment status event — acknowledge so AfterShip doesn't retry.
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const subitem = await findAccessorySubitemByTracking(slug, trackingNumber);
    if (!subitem) {
      // Not one of ours (e.g. belongs to Frame/Mats) — nothing to sync.
      return res.status(200).json({ ok: true, matched: false });
    }
    await updateAccessoryCarrierStatus(subitem.id, labelForTag(tag));
    return res.status(200).json({ ok: true, matched: true, subitemId: subitem.id });
  } catch (err) {
    console.error('AfterShip webhook processing error:', err.message);
    // Still 200 — a transient error on our side shouldn't make AfterShip retry
    // forever; the shipment's next status change will sync on its own.
    return res.status(200).json({ ok: false, error: 'Processing error.' });
  }
}
