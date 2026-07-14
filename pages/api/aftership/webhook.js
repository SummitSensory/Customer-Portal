/**
 * POST /api/aftership/webhook
 *
 * Receives AfterShip tracking-update webhooks and mirrors the live carrier
 * status onto the matching Therapy Equipment & Accessories subitem's
 * "Carrier Status" column on Monday — so staff see In Transit / Out for
 * Delivery / Delivered / Exception on the board itself, not just in the
 * portal (which already shows live status on demand via /api/aftership/track).
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
 * Only shipments tracked via the Therapy Equipment & Accessories board are
 * acted on — Frame/Mats tracking numbers are safely ignored (no match found).
 */

import crypto from 'crypto';
import { findAccessorySubitemByTracking, updateAccessoryCarrierStatus } from '../../../lib/monday';
import { labelForTag } from '../../../lib/aftership';

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
