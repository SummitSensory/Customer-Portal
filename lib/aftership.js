/**
 * AfterShip Tracking API integration (current versioned API).
 *
 * Base: https://api.aftership.com/tracking/2025-07  (override via AFTERSHIP_API_BASE)
 * Auth: AFTERSHIP_API_KEY sent as the `as-api-key` header.
 *
 * Flow (the current API retrieves by tracking ID, not slug+number):
 *   1. POST /trackings  (flat body { slug, tracking_number, title?, order_id? })
 *      → returns data.id  (also returns the id when it already exists, code 4003)
 *   2. GET /trackings/{id}  → full tracking with checkpoints
 *
 * Returns the same normalized shape as before so the portal renders it unchanged:
 *   { trackingNumber, slug, status, statusTag, estimatedDelivery,
 *     actualDelivery, events: [{ description, location, timestamp }], url }
 */

const AFTERSHIP_BASE = (process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/tracking/2025-07').replace(/\/+$/, '');

// PORTAL-021: none of this file's outbound calls previously set a timeout —
// a single hanging AfterShip request could stall a serverless invocation
// until Vercel's own platform timeout kills it, which inside the proactive
// sync cron's per-shipment loop (accessory-tracking-sync.js) silently
// truncates the run and leaves every shipment after the stuck one unsynced
// for that cycle with no automatic backfill.
const AFTERSHIP_FETCH_TIMEOUT_MS = 15000;

// PORTAL-024: AfterShip's default rate limit is 5 requests/second account-wide.
// mapWithConcurrency (lib/concurrency.js) caps the accessory-tracking-sync cron
// at 8 concurrent *shipments*, on the assumption that was enough headroom under
// AfterShip's limit — but each shipment can make up to 3 AfterShip calls of its
// own (ensureTrackingId's create POST, its "backfill customer_name/title onto an
// already-existing tracking" PUT, then trackShipment's separate GET for status),
// so 8 concurrent shipments could actually fire well over 20 near-simultaneous
// requests. Bryan saw this directly: a run logged a burst of "AfterShip update
// failed: 429" errors (all from the PUT backfill call specifically) even though
// the run still completed successfully overall — the 429s were on calls whose
// failure is swallowed with just a console.error (see ensureTrackingId below),
// not ones that abort the shipment's sync. Retrying transient 429s here, at the
// single choke point every AfterShip call already goes through, fixes it for
// every call site at once rather than patching each one individually — and is
// more correct than only lowering concurrency, since concurrency alone can't
// guarantee the account-wide request rate from a single process, let alone
// across whatever else calls this module concurrently (e.g. a customer opening
// their tracking tab while this cron is mid-run).
const AFTERSHIP_MAX_RETRIES = 3;
// AfterShip's error body says its limit window resets every 1 second — pad
// slightly so a retry doesn't land in the tail of the same window it was
// rate-limited in.
const AFTERSHIP_RETRY_BASE_MS = 1100;

async function fetchWithTimeout(url, options = {}, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AFTERSHIP_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 429 && attempt < AFTERSHIP_MAX_RETRIES) {
    const retryAfterHeader = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : AFTERSHIP_RETRY_BASE_MS * (attempt + 1);
    await new Promise(r => setTimeout(r, waitMs));
    return fetchWithTimeout(url, options, attempt + 1);
  }

  return res;
}

export const STATUS_LABELS = {
  Pending:            'Pending',
  InfoReceived:       'Info Received',
  InTransit:          'In Transit',
  OutForDelivery:     'Out for Delivery',
  AvailableForPickup: 'Available for Pickup',
  AttemptFail:        'Attempt Failed',
  Delivered:          'Delivered',
  Exception:          'Exception',
  Expired:            'Expired',
};

export function labelForTag(tag) {
  return STATUS_LABELS[tag] || tag || 'Pending';
}

function authHeaders() {
  const key = process.env.AFTERSHIP_API_KEY;
  return { 'Content-Type': 'application/json', 'as-api-key': key, 'aftership-api-key': key };
}

export function publicUrl(slug, trackingNumber) {
  return `https://track.aftership.com/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`;
}

function pending(slug, trackingNumber) {
  return {
    trackingNumber, slug, status: 'Pending', statusTag: 'Pending',
    estimatedDelivery: null, actualDelivery: null, events: [],
    url: publicUrl(slug, trackingNumber),
  };
}

function normalize(t, slug, trackingNumber) {
  if (!t) return null;
  const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
  const events = checkpoints
    .slice()          // full transit history (oldest→newest as returned)
    .reverse()        // newest first for the portal timeline
    .map(c => ({
      description: c.message || c.subtag_message || c.tag || '',
      location: [c.city, c.state, c.zip, c.country_name || c.country_region]
        .filter(Boolean).join(', '),
      timestamp: c.checkpoint_time || c.created_at || null,
      tag: c.tag || null,
    }));

  const estimatedDelivery =
    t.expected_delivery ||
    t.estimated_delivery_date ||
    t.aftership_estimated_delivery_date?.estimated_delivery_date ||
    null;

  return {
    trackingNumber: t.tracking_number || trackingNumber,
    slug: t.slug || slug,
    status: labelForTag(t.tag),
    statusTag: t.tag || null,
    estimatedDelivery,
    actualDelivery: t.shipment_delivery_date || null,
    events,
    url: publicUrl(t.slug || slug, t.tracking_number || trackingNumber),
  };
}

/** Create the tracking (idempotent) and return its AfterShip id. */
async function ensureTrackingId(slug, trackingNumber, { title, orderId, customerName } = {}) {
  const body = { slug, tracking_number: trackingNumber };
  if (title) body.title = String(title);
  if (orderId) body.order_id = String(orderId);
  if (customerName) body.customers = [{ name: String(customerName) }];

  const res = await fetchWithTimeout(`${AFTERSHIP_BASE}/trackings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));

  // 201 = created; 4003 = already exists — both return data.id.
  const id = json?.data?.id || json?.data?.tracking?.id || null;
  if (!id && !res.ok && json?.meta?.code !== 4003) {
    throw new Error(`AfterShip create failed: ${res.status} ${json?.meta?.message || ''}`);
  }

  // If the tracking already existed, the POST above was ignored (code 4003), so
  // customer_name/title were never applied. Update the existing tracking so they
  // appear — this backfills shipments onboarded before customer_name was added.
  const alreadyExisted = res.status !== 201 && id;
  if (alreadyExisted && (customerName || title)) {
    const update = {};
    if (customerName) update.customers = [{ name: String(customerName) }];
    if (title) update.title = String(title);
    try {
      const ur = await fetchWithTimeout(`${AFTERSHIP_BASE}/trackings/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(update),
      });
      if (!ur.ok) {
        const utxt = await ur.text().catch(() => '');
        console.error(`AfterShip update failed: ${ur.status} ${String(utxt).slice(0, 200)}`);
      }
    } catch (e) {
      console.error('AfterShip update network error:', e.message);
    }
  }

  return { id, data: json?.data?.tracking || json?.data || null };
}

/** Fetch the full tracking (with checkpoints) by AfterShip id. */
async function getById(id) {
  const res = await fetchWithTimeout(`${AFTERSHIP_BASE}/trackings/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.data?.tracking || json?.data || null;
}

/**
 * Get normalized tracking for a shipment (slug + tracking number).
 * Creates the AfterShip tracking on first call, then returns current status.
 * Returns null if credentials/inputs are missing.
 */
export async function trackShipment(slug, trackingNumber, meta = {}) {
  if (!process.env.AFTERSHIP_API_KEY) return null;
  if (!slug || !trackingNumber) return null;

  try {
    const { id, data } = await ensureTrackingId(slug, trackingNumber, meta);
    if (!id) {
      return normalize(data, slug, trackingNumber) || pending(slug, trackingNumber);
    }
    const t = await getById(id);
    return normalize(t, slug, trackingNumber) || pending(slug, trackingNumber);
  } catch (err) {
    console.error('AfterShip tracking error:', err.message);
    return null;
  }
}

/**
 * Register a shipment with AfterShip without fetching status (POST only).
 * Lightweight — used by the proactive sync cron to onboard many shipments
 * quickly. Returns the AfterShip tracking id (created or already-existing),
 * or null if credentials/inputs are missing or the create failed.
 */
export async function onboardShipment(slug, trackingNumber, meta = {}) {
  if (!process.env.AFTERSHIP_API_KEY) return null;
  if (!slug || !trackingNumber) return null;
  try {
    const { id } = await ensureTrackingId(slug, trackingNumber, meta);
    return id || null;
  } catch (err) {
    console.error('AfterShip onboard error:', err.message);
    return null;
  }
}
