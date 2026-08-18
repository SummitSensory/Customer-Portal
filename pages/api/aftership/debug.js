/**
 * GET /api/aftership/debug?slug=...&number=...
 * Staff-only diagnostic for the AfterShip integration.
 *
 * Optional query params for testing endpoints:
 *   &create=1                 also POST-creates the tracking (what the portal does)
 *   &base=<url>               override the API base (e.g. https://api.aftership.com/tracking/2025-07)
 *   &flat=1                   send the CREATE body flat ({tracking_number, slug}) instead of {tracking:{...}}
 *
 * Never exposes the full key.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const DEFAULT_BASE = process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/tracking/2025-07';

// PORTAL-020: `base` used to accept ANY value with no validation, so this
// endpoint would send the live AFTERSHIP_API_KEY (as a request header) to
// whatever host a caller specified. Exploiting it requires an authenticated
// staff session (this route is gated below), but a compromised or overly
// curious staff account could otherwise redirect the real API key to an
// attacker-controlled host. Restrict to AfterShip's own known API hosts.
// Includes DEFAULT_BASE's own host so a custom AFTERSHIP_API_BASE (set via
// env var, under staff/deploy control) is still honored as a legitimate
// override target, without opening this up to an arbitrary caller-supplied host.
const ALLOWED_BASE_HOSTS = [...new Set(['api.aftership.com', new URL(DEFAULT_BASE).hostname])];
function resolveBase(rawBase) {
  if (!rawBase) return DEFAULT_BASE;
  try {
    const url = new URL(String(rawBase));
    if (url.protocol === 'https:' && ALLOWED_BASE_HOSTS.includes(url.hostname)) {
      return String(rawBase).replace(/\/+$/, '');
    }
  } catch { /* falls through to default below */ }
  return DEFAULT_BASE;
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Staff sign-in required.' });

  const { slug, number } = req.query;
  const key = process.env.AFTERSHIP_API_KEY || '';
  const base = resolveBase(req.query.base);
  const flat = !!req.query.flat;

  const info = {
    apiKeyPresent: !!key,
    apiKeyPreview: key ? `${key.slice(0, 9)}…(${key.length} chars)` : null,
    usedBase: base,
    slug: slug || null,
    number: number || null,
  };

  if (!key) return res.status(200).json({ ...info, note: 'AFTERSHIP_API_KEY is NOT set in this environment.' });
  if (!req.query.id && (!slug || !number)) return res.status(200).json({ ...info, note: 'Pass ?slug=...&number=... (or ?id=...) to test a shipment.' });

  const headers = { 'Content-Type': 'application/json', 'as-api-key': key, 'aftership-api-key': key };
  const result = { ...info };
  const clip = (v) => (typeof v === 'string' ? v : JSON.stringify(v) || '').slice(0, 400);

  try {
    if (req.query.create) {
      const body = flat
        ? { tracking_number: number, slug }
        : { tracking: { slug, tracking_number: number } };
      const cr = await fetch(`${base}/trackings`, { method: 'POST', headers, body: JSON.stringify(body) });
      const cText = await cr.text();
      let cBody; try { cBody = JSON.parse(cText); } catch { cBody = cText; }
      result.createHttpStatus = cr.status;                 // 201 = created
      result.createMeta = cBody?.meta ?? null;
      result.createBodyPreview = clip(cBody);              // helps confirm the response shape
    }

    // Optional: ?id=...&updateName=... — test PUT-updating customer_name on an existing tracking.
    if (req.query.id && req.query.updateName) {
      const ur = await fetch(`${base}/trackings/${encodeURIComponent(req.query.id)}`, {
        method: 'PUT', headers, body: JSON.stringify({ customers: [{ name: String(req.query.updateName) }] }),
      });
      const uText = await ur.text();
      let uBody; try { uBody = JSON.parse(uText); } catch { uBody = uText; }
      result.updateHttpStatus = ur.status;                 // 200 = updated
      result.updateMeta = uBody?.meta ?? null;
      result.updateBodyPreview = clip(uBody);
    }

    const getUrl = req.query.id
      ? `${base}/trackings/${encodeURIComponent(req.query.id)}`                       // current API: fetch by id
      : `${base}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(number)}`; // legacy: slug+number
    const r = await fetch(getUrl, { headers });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    const t = body?.data?.tracking || body?.data || null;

    result.getHttpStatus = r.status;
    result.getMeta = body?.meta ?? null;
    result.trackingTag = t?.tag ?? null;
    result.trackingSlug = t?.slug ?? null;
    result.customerName = t?.customer_name ?? null;
    result.customers = t?.customers ?? null;
    result.checkpointCount = Array.isArray(t?.checkpoints) ? t.checkpoints.length : null;
    // Full tracking object (minus bulky checkpoints) so we can see the exact field names.
    if (req.query.raw && t) {
      const { checkpoints, ...rest } = t;
      result.rawTracking = rest;
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ ...result, fetchError: err.message });
  }
}
