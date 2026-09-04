/**
 * AfterShip Tracking API integration (current versioned API).
 *
 * Base: https://api.aftership.com/tracking/2025-07  (override via AFTERSHIP_API_BASE)
 * Auth: AFTERSHIP_API_KEY sent as the `as-api-key` header.
 *
 * Flow (the current API retrieves by tracking ID, not slug+number):
 *   1. POST /trackings  (flat body { slug, tracking_number, title?, order_id?,
 *      customers?: [{ name?, email?, phone_number? }], custom_fields?: {} })
 *      → returns data.id  (also returns the id when it already exists, code 4003)
 *   2. GET /trackings/{id}  → full tracking with checkpoints
 *
 * `customers[].email`/`.phone_number` are what register a real recipient
 * with AfterShip's OWN native notification flows (configured in the
 * AfterShip dashboard, Notifications → Flows) — this file only calls the
 * Tracking API for data; it does not itself decide what a notification says
 * or who else it's cc'd to beyond the customers array sent here. See
 * buildCustomers() / ensureTrackingId() below.
 *
 * `custom_fields` (arbitrary string key/value pairs) each become their own
 * merge tag in AfterShip's template editor — used here (see
 * buildShipmentTypeCustomField) so "Sensory Gym Frame" vs. "Therapy Mats &
 * Padding" is available as its own clean variable, not just baked into the
 * combined `title` string.
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
// Previously trackShipment()/onboardShipment() below returned null on a
// missing key with zero log output — indistinguishable from "no shipments to
// track yet." A revoked/unset key after go-live would silently stop all
// tracking updates with nothing in the logs to catch it. Logged once per
// cold start (not once per shipment) to avoid spamming Vercel's log volume.
let _aftershipKeyMissingLogged = false;
function warnIfKeyMissing() {
  if (process.env.AFTERSHIP_API_KEY || _aftershipKeyMissingLogged) return;
  console.warn('AfterShip tracking skipped: AFTERSHIP_API_KEY not configured.');
  _aftershipKeyMissingLogged = true;
}

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

// Human-readable shipment-type labels. Used both for our own Resend email
// subject/body (pages/api/aftership/webhook.js) and, as of 2026-09-03, in
// the `title` sent to AfterShip itself (see buildTrackingTitle below) — a
// single source so the two can never drift apart. Direct requirement from
// Bryan: a customer with both a Frame and a Mats shipment on one order
// needs each AfterShip notification to say which shipment it's about,
// since both were previously given the exact same title (the order name).
// 'accessory' added 2026-09-03, direct requirement from Bryan: Therapy
// Equipment & Accessories is a third real shipment type customers should
// get AfterShip notifications for, alongside Frame and Mats.
export const SHIPMENT_LABELS = {
  frame: 'Sensory Gym Frame',
  mats: 'Therapy Mats & Padding',
  accessory: 'Therapy Equipment & Accessories',
};

/**
 * Builds an AfterShip tracking title that disambiguates shipments on the
 * same order (Frame vs. Mats vs. an accessory item), instead of sending the
 * identical order name for all of them. `detail`, when given, replaces the
 * generic SHIPMENT_LABELS text — used for accessory items, where the
 * item's own specific name (e.g. "Weighted Blanket") is more useful than
 * the generic "Therapy Equipment & Accessories" bucket label, since one
 * order can have several different accessory items each needing their own
 * distinguishable title. Frame/Mats callers omit it and get the generic
 * label as before.
 */
export function buildTrackingTitle(orderName, shipmentKey, detail) {
  const label = detail || SHIPMENT_LABELS[shipmentKey];
  if (!orderName) return label || undefined;
  return label ? `${orderName} — ${label}` : orderName;
}

/**
 * Builds the `custom_fields.shipment_type` value for a shipment. Bryan's
 * follow-up question (2026-09-03): buildTrackingTitle's label lives INSIDE
 * one combined title string ("Order #123 — Therapy Mats & Padding"), which
 * is awkward to write a natural sentence around in an AfterShip template
 * ("Your {{SHIPMENT_TITLE}} shipment is on its way!" reads oddly with the
 * order name baked in). `custom_fields.shipment_type` sends the label as
 * its OWN merge tag (surfaced in AfterShip's template editor, exact tag
 * name/casing to be confirmed there — see AfterShip's docs on custom-field
 * merge tags), so a template can read naturally: "Your {{SHIPMENT_TYPE}}
 * shipment is on its way!". Always the generic label (e.g. "Therapy
 * Equipment & Accessories"), even when buildTrackingTitle used a more
 * specific `detail` for that same shipment's title.
 */
export function buildShipmentTypeCustomField(shipmentKey) {
  const label = SHIPMENT_LABELS[shipmentKey];
  return label ? { shipment_type: label } : {};
}

/**
 * Extracts a safe "first name" from a full contact name (e.g. "Jane
 * Customer" -> "Jane"), for merge-tag personalization ("Hi {{FIRST_NAME}},
 * ..."). AfterShip's own `customers[].name` field stores one full-name
 * string with no first/last split, and there is no confirmed standalone
 * first-name merge tag in AfterShip's documented set — so this is derived
 * here and sent as our own custom field instead of relying on AfterShip to
 * split it.
 */
export function firstNameOf(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

/**
 * Builds the full `custom_fields` object for a shipment: shipment_type (see
 * buildShipmentTypeCustomField above) plus first_name, derived from the
 * PRIMARY contact only. Direct requirement from Bryan (2026-09-03): greet
 * the customer by first name in the email body.
 *
 * KNOWN LIMITATION — an AfterShip platform constraint, not something our
 * code can route around: custom_fields live on the TRACKING, not per
 * recipient. If both a primary and secondary contact are registered on the
 * same tracking (see lib/monday.js's resolveDeliveryContacts), AfterShip
 * sends them the exact same rendered email — the secondary contact will
 * also see the PRIMARY contact's first name in the greeting, not their
 * own. AfterShip's API has no per-recipient template-variable mechanism to
 * route around this; disclosed, not hidden.
 */
export function buildCustomFields(shipmentKey, contacts) {
  const fields = buildShipmentTypeCustomField(shipmentKey);
  const firstName = firstNameOf(contacts?.[0]?.name);
  if (firstName) fields.first_name = firstName;
  return fields;
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

// AfterShip's 2025-07 API allows up to 3 `customers` objects per tracking,
// each with its own name/email/phone_number — this is what actually
// determines who AfterShip's own native, dashboard-configured notification
// flows email/text when a shipment's status changes (see the Notifications
// section of the AfterShip dashboard). Verified against AfterShip's current
// docs (2026-09-03): the legacy flat `customer_name`/`emails`/`smses`
// fields were replaced by `customers[].name`/`.email`/`.phone_number` in
// this API version.
//
// Direct requirement from Bryan (2026-09-03): register the customer's own
// approved delivery contact(s) — not just an order title — so AfterShip's
// branded notifications actually have someone real to send to. `contacts`
// (from lib/monday.js's resolveDeliveryContacts) takes priority; bare
// `customerName` (no email/phone) is kept as a fallback for callers that
// only have an order title and no delivery-contact data yet (e.g. before a
// customer has submitted the Delivery tab at all), so the tracking still
// shows a readable name in the AfterShip dashboard either way.
const MAX_AFTERSHIP_CUSTOMERS = 3;
function buildCustomers(customerName, contacts) {
  const list = [];
  for (const c of contacts || []) {
    if (!c) continue;
    const entry = {};
    if (c.name) entry.name = String(c.name);
    if (c.email) entry.email = String(c.email);
    if (c.phone) entry.phone_number = String(c.phone);
    if (Object.keys(entry).length) list.push(entry);
  }
  if (!list.length && customerName) list.push({ name: String(customerName) });
  return list.slice(0, MAX_AFTERSHIP_CUSTOMERS);
}

/** Create the tracking (idempotent) and return its AfterShip id. */
async function ensureTrackingId(slug, trackingNumber, { title, orderId, customerName, contacts, customFields } = {}) {
  const body = { slug, tracking_number: trackingNumber };
  if (title) body.title = String(title);
  if (orderId) body.order_id = String(orderId);
  const customers = buildCustomers(customerName, contacts);
  if (customers.length) body.customers = customers;
  if (customFields && Object.keys(customFields).length) body.custom_fields = customFields;

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
  // customers/title/custom_fields were never applied. Update the existing
  // tracking so they appear — this backfills shipments onboarded before a
  // delivery contact was available (or before any of this was sent at all).
  const alreadyExisted = res.status !== 201 && id;
  if (alreadyExisted && (customers.length || title || (customFields && Object.keys(customFields).length))) {
    const update = {};
    if (customers.length) update.customers = customers;
    if (title) update.title = String(title);
    if (customFields && Object.keys(customFields).length) update.custom_fields = customFields;
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
  if (!process.env.AFTERSHIP_API_KEY) { warnIfKeyMissing(); return null; }
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
  if (!process.env.AFTERSHIP_API_KEY) { warnIfKeyMissing(); return null; }
  if (!slug || !trackingNumber) return null;
  try {
    const { id } = await ensureTrackingId(slug, trackingNumber, meta);
    return id || null;
  } catch (err) {
    console.error('AfterShip onboard error:', err.message);
    return null;
  }
}
