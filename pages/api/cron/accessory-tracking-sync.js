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
// vercel.json schedule: hourly ("0 * * * *"). Previously every 15 minutes,
// but EP-22 (the real-time Monday->AfterShip webhook, confirmed LIVE
// 2026-08-19 — see Customer-Portal-Process-Flow.md) now pushes new Carrier
// Code/Freight Tracking ID entries to AfterShip within seconds, so this job
// only needs to catch the rare item that slips through (e.g. a webhook retry
// exhausted, or a row edited before the webhook was configured) — running it
// 4x as often added Monday/AfterShip API load without meaningfully improving
// how fast anything showed up for staff or customers. AfterShip's own webhook
// (EP-21) still updates status in real time once a shipment has been
// onboarded at least once — this job only affects how quickly a brand-new
// item gets its first onboarding.

import { getAllAccessoryItems, updateAccessoryCarrierStatus, getAllOrders, resolveDeliveryContacts } from '../../../lib/monday';
import { trackShipment, onboardShipment, buildTrackingTitle, buildShipmentTypeCustomField } from '../../../lib/aftership';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';

// Same reasoning as REMINDER_CONCURRENCY in cron/reminders.js — this job's two
// loops (accessory items, then orders' Frame/Mats shipments) each make an
// AfterShip call per row, so run time used to scale linearly with board size.
// Concurrent calls cut run time roughly N-fold on boards with many rows.
//
// PORTAL-024: lowered from 8 to 4. Each "row" here can actually make up to 3
// AfterShip calls of its own (see lib/aftership.js's ensureTrackingId), so 8
// concurrent rows could burst well past AfterShip's 5-req/s account-wide
// limit, as confirmed by a real run's "AfterShip update failed: 429" bursts.
// lib/aftership.js now retries a 429 with backoff regardless of concurrency
// here, but a smaller burst size means fewer retries are needed in the first
// place — this and the retry logic are complementary, not redundant.
const SYNC_CONCURRENCY = 4;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const items = await getAllAccessoryItems();
    const candidates = items.filter((i) => i.carrierSlug && i.trackingNumber);

    let updated = 0;
    let errors = 0;
    await mapWithConcurrency(candidates, SYNC_CONCURRENCY, async (item) => {
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
        errors++;
      }
    });

    // Proactively onboard parent-level Frame + Mats shipments too, so they appear
    // in AfterShip without waiting for a customer to open the portal (the loop
    // above only covers accessory subitems). Frame: text_mm538vtm/text_mm53p3b2;
    // Mats: text_mm51pap1/text_mm51wdm5.
    let framesMatsOnboarded = 0;
    try {
      const orders = await getAllOrders();
      await mapWithConcurrency(orders, SYNC_CONCURRENCY, async (order) => {
        const shipments = [
          { key: 'frame', slug: order.frameCarrierSlug, number: order.frameTrackingId },
          { key: 'mats', slug: order.matsCarrierSlug, number: order.matsTrackingId },
        ].filter((s) => s.slug && s.number);
        if (!shipments.length) return;
        // Direct requirement (2026-09-03): register the customer's own
        // approved delivery contact(s) with AfterShip on every proactive
        // onboard too, not just the lazy customer-triggered path in
        // pages/api/aftership/track.js — otherwise a shipment onboarded by
        // this cron before the customer ever opens the portal would have no
        // recipient at all until they did.
        const { primary, secondary } = resolveDeliveryContacts(order);
        const contacts = [primary, secondary].filter(Boolean);
        for (const s of shipments) {
          // Disambiguated title (2026-09-03): a customer with both a Frame
          // and a Mats shipment previously got the identical order name on
          // both AfterShip trackings — nothing said which shipment a given
          // notification was about. See lib/aftership.js's buildTrackingTitle.
          const title = buildTrackingTitle(order.name, s.key);
          // A standalone SHIPMENT_TYPE-style merge tag, separate from the
          // combined title, so an AfterShip email template can read
          // naturally (e.g. "Your Therapy Mats & Padding shipment is on
          // its way!") instead of quoting the whole order-name+type title.
          const customFields = buildShipmentTypeCustomField(s.key);
          const id = await onboardShipment(s.slug, s.number, { title, orderId: order.id, customerName: order.name, contacts, customFields });
          if (id) framesMatsOnboarded++;
        }
      });
    } catch (err) {
      console.error('Frame/Mats onboarding error:', err.message);
    }

    // PORTAL-022: log the run summary explicitly so a partial run (a hung
    // outbound call mid-loop, see PORTAL-021) is visible in Vercel's function
    // logs — previously this only went out in the HTTP response body, which
    // nothing reads for a scheduled Cron invocation.
    console.log(`Accessory tracking sync summary: checked=${candidates.length} updated=${updated} errors=${errors} framesMatsOnboarded=${framesMatsOnboarded}`);

    // Same reasoning as cron/reminders.js: every per-item failure above is
    // caught inline, so a systemic cause (revoked AFTERSHIP_API_KEY, a
    // renamed Monday column) previously let this run complete "successfully"
    // with updated=0 and no alert. Only fires when there was something to do
    // and literally none of it worked — a normal run with nothing changed
    // (errors=0) stays silent.
    if (candidates.length > 0 && updated === 0 && errors === candidates.length) {
      await reportCriticalFailure(
        'cron/accessory-tracking-sync',
        `Accessory tracking sync completed but every tracked item failed (checked=${candidates.length}, errors=${errors}). Likely a systemic issue (revoked/missing AFTERSHIP_API_KEY, a renamed Monday column) rather than isolated per-item failures — check Vercel function logs.`,
        { checked: candidates.length, updated, errors, framesMatsOnboarded }
      );
    }

    return res.status(200).json({ ok: true, checked: candidates.length, updated, errors, framesMatsOnboarded });
  } catch (err) {
    console.error('Accessory tracking sync error (run did not complete):', err.message);
    // PORTAL-023: same reasoning as cron/reminders — a run that never completes
    // is otherwise only visible to someone who happens to check Vercel logs.
    await reportCriticalFailure(
      'cron/accessory-tracking-sync',
      'Accessory tracking sync run failed before completing.',
      { error: err.message }
    );
    return res.status(500).json({ error: 'Sync failed.' });
  }
}
