/**
 * POST /api/monday/accessory-webhook
 *
 * The push half of the real-time tracking loop (the pull half is
 * /api/aftership/webhook). Monday calls this the instant staff enter or
 * change the "Carrier Code" or "Freight Tracking ID" column on a Therapy
 * Equipment & Accessories subitem. As soon as both values are present, this
 * immediately creates/looks up the shipment in AfterShip and writes its
 * current status back onto "Carrier Status" right away — so staff see
 * something in Monday within seconds of entering the freight details,
 * instead of waiting for AfterShip's own webhook to fire on its next
 * checkpoint. AfterShip's webhook (EP-21) then keeps that column current as
 * the shipment actually moves through transit.
 *
 * One-time setup: this endpoint is registered as a Monday webhook subscribed
 * to board 6533701061 (change_column_value). A shared secret is passed as a
 * query param on the registered URL and checked below, since Monday's
 * classic webhook API doesn't sign requests the way AfterShip's does.
 */

import { getAccessorySubitemById, updateAccessoryCarrierStatus, ACCESSORY_COLS } from '../../../lib/monday';
import { trackShipment } from '../../../lib/aftership';

// Columns that should trigger a push to AfterShip when they change. Anything
// else (Order Status, Date Ordered, Carrier Status itself, etc.) is ignored.
const TRIGGER_COLUMNS = new Set([ACCESSORY_COLS.carrier, ACCESSORY_COLS.trackingNumber]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Monday's webhook subscription flow occasionally re-verifies a URL by
  // POSTing a challenge — echo it straight back.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const secret = process.env.MONDAY_ACCESSORY_WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Invalid secret.' });
  }

  const event = req.body?.event;
  const subitemId = event?.pulseId;
  const columnId = event?.columnId;

  if (!subitemId || !columnId || !TRIGGER_COLUMNS.has(columnId)) {
    // Not a change we care about — acknowledge so Monday doesn't retry.
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const subitem = await getAccessorySubitemById(subitemId);
    if (!subitem?.carrierSlug || !subitem?.trackingNumber) {
      // Only one of the two fields is filled in so far — nothing to push yet.
      return res.status(200).json({ ok: true, waitingOnFields: true });
    }

    const tracking = await trackShipment(subitem.carrierSlug, subitem.trackingNumber, {
      title: subitem.name,
      orderId: subitemId,
    });

    if (tracking?.status) {
      await updateAccessoryCarrierStatus(subitemId, tracking.status);
    }

    return res.status(200).json({ ok: true, pushed: true, status: tracking?.status || null });
  } catch (err) {
    console.error('Monday accessory-webhook processing error:', err.message);
    // Still 200 — a transient error here shouldn't make Monday retry forever;
    // AfterShip's own webhook (EP-21) will catch the status up regardless.
    return res.status(200).json({ ok: false, error: 'Processing error.' });
  }
}
