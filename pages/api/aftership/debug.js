/**
 * GET /api/aftership/debug?slug=...&number=...
 * Staff-only diagnostic. Shows whether the API key is present in THIS
 * environment and exactly what AfterShip returns for a given shipment,
 * so we can see why tracking isn't appearing. Safe to leave in place;
 * it never exposes the full key.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const BASE = process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/v4';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Staff sign-in required.' });

  const { slug, number } = req.query;
  const key = process.env.AFTERSHIP_API_KEY || '';

  const info = {
    apiKeyPresent: !!key,
    apiKeyPreview: key ? `${key.slice(0, 9)}…(${key.length} chars)` : null,
    apiBase: BASE,
    slug: slug || null,
    number: number || null,
  };

  if (!key) return res.status(200).json({ ...info, note: 'AFTERSHIP_API_KEY is NOT set in this environment. Add it in Vercel and redeploy.' });
  if (!slug || !number) return res.status(200).json({ ...info, note: 'Pass ?slug=...&number=... to test a shipment.' });

  const headers = { 'Content-Type': 'application/json', 'as-api-key': key, 'aftership-api-key': key };
  const result = { ...info };

  try {
    // Optional: ?create=1 registers the tracking in AfterShip (what the portal does on first view).
    if (req.query.create) {
      const cr = await fetch(`${BASE}/trackings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tracking: { slug, tracking_number: number } }),
      });
      const cText = await cr.text();
      let cBody; try { cBody = JSON.parse(cText); } catch { cBody = cText; }
      result.createHttpStatus = cr.status;          // 201 = created, 400/409 w/ 4003 = already exists
      result.createMeta = cBody?.meta ?? null;      // AfterShip's message if the create was rejected
    }

    // Look up the tracking
    const r = await fetch(`${BASE}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(number)}`, { headers });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    const t = body?.data?.tracking;

    result.getHttpStatus = r.status;                // 200 = found, 401 = bad key, 404 = not created yet
    result.aftershipMeta = body?.meta ?? null;
    result.trackingTag = t?.tag ?? null;            // e.g. "Delivered", "InTransit", "Pending"
    result.trackingSlug = t?.slug ?? null;
    result.checkpointCount = Array.isArray(t?.checkpoints) ? t.checkpoints.length : null;
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ ...result, fetchError: err.message });
  }
}
