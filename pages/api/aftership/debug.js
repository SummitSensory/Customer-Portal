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

const DEFAULT_BASE = process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/v4';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Staff sign-in required.' });

  const { slug, number } = req.query;
  const key = process.env.AFTERSHIP_API_KEY || '';
  const base = String(req.query.base || DEFAULT_BASE).replace(/\/+$/, '');
  const flat = !!req.query.flat;

  const info = {
    apiKeyPresent: !!key,
    apiKeyPreview: key ? `${key.slice(0, 9)}…(${key.length} chars)` : null,
    usedBase: base,
    slug: slug || null,
    number: number || null,
  };

  if (!key) return res.status(200).json({ ...info, note: 'AFTERSHIP_API_KEY is NOT set in this environment.' });
  if (!slug || !number) return res.status(200).json({ ...info, note: 'Pass ?slug=...&number=... to test a shipment.' });

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

    const r = await fetch(`${base}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(number)}`, { headers });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    const t = body?.data?.tracking || body?.data || null;

    result.getHttpStatus = r.status;
    result.getMeta = body?.meta ?? null;
    result.trackingTag = t?.tag ?? null;
    result.trackingSlug = t?.slug ?? null;
    result.checkpointCount = Array.isArray(t?.checkpoints) ? t.checkpoints.length : null;
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ ...result, fetchError: err.message });
  }
}
