// GET /api/cron/accessory-tracking-sync
//
// Keeps AfterShip "onboarded" on every Therapy Equipment & Accessories item
// that has both a Carrier Code and a Freight Tracking ID — proactively, on a
// schedule, instead of waiting for a customer to open the portal first.
//
// Why this exists: AfterShip only starts tracking (and therefore only fires
// its own webhook, EP-21, with live status updates) once something has asked
// it to. The portal does that lazily, when a customer expands tracking. This
// job does it proactively, so "Carrier Status" on Monday starts updating
// automatically as soon as staff fill in the two fields — no customer visit
// required.
//
// A direct Monday-side webhook (push the instant Carrier Code / Freight
// Tracking ID change) was attempted first but Monday's API rejected it:
// "Creating webhook on subitems board isn't allowed", and the documented
// workaround (`change_subitem_column_value` registered on the parent board)
// returned a server-side internal error on retry. This polling job is the
// reliable fallback — see Customer-Portal-Process-Flow.md EP-22/EP-23.
//
// vercel.json schedule: every 15 minutes (star-slash-15 star star star star)
// — requires Vercel Pro or higher; Hobby-tier projects silently cap cron
// frequency at once per day. AfterShip's own webhook (EP-21) still updates
// status in real time once a shipment has been onboarded at least once —
// this job only affects how quickly a brand-new item gets its first
// onboarding.

import { getAllAccessoryItems, updateAccessoryCarrierStatus, getAllOrders } from '../../../lib/monday';
import { trackShipment, onboardShipment } from '../../../lib/aftership';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const items = await getAllAccessoryItems();
    const candidates = items.filter((i) => i.carrierSlug && i.trackingNumber);

    let updated = 0;
    for (const item of candidates) {
      try {
        const tracking = await trackShipment(item.carrierSlug, item.trackingNumber, {
          title: item.name,
          orderId: item.id,
          customerName: item.name,
        });
        if (tracking?.status && tracking.status !== item.carrierStatus) {
          await updateAccessoryCarrierStatus(item.id, tracking.status);
          updated++;
        }
      } catch (err) {
        console.error(`Accessory tracking sync failed for item ${item.id}:`, err.message);
      }
    }

    // Proactively onboard parent-level Frame + Mats shipments too, so they appear
    // in AfterShip without waiting for a customer to open the portal (the loop
    // above only covers accessory subitems). Frame: text_mm538vtm/text_mm53p3b2;
    // Mats: text_mm51pap1/text_mm51wdm5.
    let framesMatsOnboarded = 0;
    try {
      const orders = await getAllOrders();
      for (const order of orders) {
        const shipments = [
          { slug: order.frameCarrierSlug, number: order.frameTrackingId },
          { slug: order.matsCarrierSlug, number: order.matsTrackingId },
        ].filter((s) => s.slug && s.number);
        for (const s of shipments) {
          const id = await onboardShipment(s.slug, s.number, { title: order.name, orderId: order.id, customerName: order.name });
          if (id) framesMatsOnboarded++;
        }
      }
    } catch (err) {
      console.error('Frame/Mats onboarding error:', err.message);
    }

    // PORTAL-022: log the run summary explicitly so a partial run (a hung
    // outbound call mid-loop, see PORTAL-021) is visible in Vercel's function
    // logs — previously this only went out in the HTTP response body, which
    // nothing reads for a scheduled Cron invocation.
    console.log(`Accessory tracking sync summary: checked=${candidates.length} updated=${updated} framesMatsOnboarded=${framesMatsOnboarded}`);
    return res.status(200).json({ ok: true, checked: candidates.length, updated, framesMatsOnboarded });
  } catch (err) {
    console.error('Accessory tracking sync error (run did not complete):', err.message);
    return res.status(500).json({ error: 'Sync failed.' });
  }
}
