/**
 * AfterShip Tracking API integration.
 *
 * Carrier-agnostic tracking (freight + parcel). Returns the SAME normalized
 * shape as lib/fedex.js so the portal's ShipmentCard / TrackingRow render it
 * with no UI changes:
 *   { trackingNumber, slug, status, statusTag, estimatedDelivery,
 *     actualDelivery, events: [{ description, location, timestamp }], url }
 *
 * Auth: AFTERSHIP_API_KEY sent as the `as-api-key` header (also sends the
 * legacy `aftership-api-key` header for compatibility).
 *
 * A tracking is created on first lookup (create-on-view) so that once a
 * shipment is viewed, AfterShip begins polling the carrier and future status
 * webhooks flow. Passing order title/id lets webhooks be matched back later.
 */

const AFTERSHIP_BASE = process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/v4';

// AfterShip normalized status tag → friendly label.
// These labels match the Monday "Delivery Status" column labels (see reference doc §2b / PLAN-2).
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
  return {
    'Content-Type': 'application/json',
    'as-api-key': key,          // current header
    'aftership-api-key': key,   // legacy header (harmless if ignored)
  };
}

function publicUrl(slug, trackingNumber) {
  return `https://track.aftership.com/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`;
}

// Pull the tracking object out of any known response envelope
// (v4 wraps in { data: { tracking } }; newer versions may return it flat).
function extractTracking(json) {
  if (!json) return null;
  return json.data?.tracking || json.tracking || (json.tag ? json : null);
}

function normalize(t, slug, trackingNumber) {
  if (!t) return null;
  const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
  const events = checkpoints
    .slice(-10)      // AfterShip returns oldest→newest; keep the last 10
    .reverse()       // show newest first, matching the FedEx renderer
    .map(c => ({
      description: c.message || c.subtag_message || c.tag || '',
      location: [c.city, c.state, c.country_name].filter(Boolean).join(', '),
      timestamp: c.checkpoint_time || c.created_at || null,
    }));

  return {
    trackingNumber: t.tracking_number || trackingNumber,
    slug: t.slug || slug,
    status: labelForTag(t.tag),
    statusTag: t.tag || null,
    estimatedDelivery: t.expected_delivery || null,
    actualDelivery: t.shipment_delivery_date || null,
    events,
    url: publicUrl(t.slug || slug, t.tracking_number || trackingNumber),
  };
}

async function getExisting(slug, trackingNumber) {
  const res = await fetch(
    `${AFTERSHIP_BASE}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`AfterShip GET failed: ${res.status}`);
  return { tracking: extractTracking(await res.json()) };
}

async function createTracking(slug, trackingNumber, { title, orderId } = {}) {
  const tracking = { slug, tracking_number: trackingNumber };
  if (title) tracking.title = String(title);
  if (orderId) tracking.order_id = String(orderId);

  const res = await fetch(`${AFTERSHIP_BASE}/trackings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ tracking }),
  });

  // 201 = created. A tracking that already exists returns 400/409 with code 4003 — tolerate it.
  if (!res.ok && res.status !== 201) {
    const txt = await res.text().catch(() => '');
    if (!/already exists|4003/i.test(txt)) {
      throw new Error(`AfterShip POST failed: ${res.status} ${txt}`);
    }
  }
  return extractTracking(await res.json().catch(() => ({})));
}

/**
 * Get normalized tracking for a shipment (slug + tracking number).
 * Creates the AfterShip tracking on first call, then returns current status.
 * Returns null if credentials or inputs are missing (portal shows a fallback).
 *
 * @param {string} slug           AfterShip carrier slug (e.g. "fedex", "estes")
 * @param {string} trackingNumber Carrier tracking / PRO number
 * @param {object} meta           { title, orderId } — attached on create for later matching
 */
export async function trackShipment(slug, trackingNumber, meta = {}) {
  if (!process.env.AFTERSHIP_API_KEY) return null;
  if (!slug || !trackingNumber) return null;

  try {
    const existing = await getExisting(slug, trackingNumber);

    if (existing.notFound) {
      const created = await createTracking(slug, trackingNumber, meta);
      // A newly created tracking usually has no checkpoints yet — show "Pending".
      return normalize(created, slug, trackingNumber) || {
        trackingNumber, slug, status: 'Pending', statusTag: 'Pending',
        estimatedDelivery: null, actualDelivery: null, events: [],
        url: publicUrl(slug, trackingNumber),
      };
    }

    return normalize(existing.tracking, slug, trackingNumber);
  } catch (err) {
    console.error('AfterShip tracking error:', err.message);
    return null;
  }
}
