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
async function ensureTrackingId(slug, trackingNumber, { title, orderId } = {}) {
  const body = { slug, tracking_number: trackingNumber };
  if (title) body.title = String(title);
  if (orderId) body.order_id = String(orderId);

  const res = await fetch(`${AFTERSHIP_BASE}/trackings`, {
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
  return { id, data: json?.data?.tracking || json?.data || null };
}

/** Fetch the full tracking (with checkpoints) by AfterShip id. */
async function getById(id) {
  const res = await fetch(`${AFTERSHIP_BASE}/trackings/${encodeURIComponent(id)}`, { headers: authHeaders() });
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
