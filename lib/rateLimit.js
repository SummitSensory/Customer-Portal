/**
 * PORTAL-027: lightweight per-IP rate limiting for public-facing endpoints
 * that trigger an email send (send-code, referral submission). No
 * Redis/Vercel KV is provisioned in this project, so this is an in-memory
 * sliding-window counter — it resets on cold start and is scoped to a single
 * serverless instance, so it will NOT catch abuse spread across many
 * concurrent instances the way a shared store would. It DOES catch the
 * common case (repeated requests hitting the same warm instance) and is a
 * meaningful improvement over no limiting at all. If abuse becomes a real
 * problem, upgrade to Vercel KV/Upstash for a durable, cross-instance limit.
 */

const buckets = new Map(); // key -> array of request timestamps (ms)

/**
 * Returns true if the request should be ALLOWED, false if it should be
 * rejected (rate limited). `key` should combine the route + client IP.
 */
export function allowRequest(key, { maxRequests = 5, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    buckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  buckets.set(key, timestamps);

  // Bound memory growth — occasionally sweep fully-expired keys.
  if (buckets.size > 5000) {
    for (const [k, ts] of buckets) {
      if (!ts.some((t) => now - t < windowMs)) buckets.delete(k);
    }
  }
  return true;
}

/** Best-effort client IP from standard proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
