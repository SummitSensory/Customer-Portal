/**
 * AUDIT-2026-10-06 (follow-up): an atomic "only one sender wins" claim for
 * customer emails whose dedupe is otherwise read-marker → send → write-marker
 * against Monday (freight status emails in pages/api/aftership/webhook.js,
 * staff-reply notifications in lib/replyNotify.js). Monday has no
 * compare-and-swap, so two deliveries landing within the same second (an
 * AfterShip batch of checkpoints, update-webhook racing the reply cron) both
 * read "not notified yet" and both send. A Redis `SET key NX EX ttl` is
 * atomic: exactly one caller gets the claim.
 *
 * Backed by Upstash Redis's REST API (what Vercel's Marketplace "Upstash for
 * Redis" / legacy Vercel KV integration provisions) via plain fetch — no SDK
 * dependency. Reads KV_REST_API_URL / KV_REST_API_TOKEN (Vercel's env names)
 * or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 *
 * Fails OPEN: with no store configured, or the store erroring/timing out,
 * the claim is granted and the caller behaves exactly as it did before this
 * existed (the Monday marker remains the durable dedupe). A missed customer
 * email is worse than the rare duplicate this closes. Logged with
 * console.warn, not console.error, so a store outage doesn't page anyone via
 * lib/errorAlerts.js on every send.
 */

const STORE_TIMEOUT_MS = 2500;
let warnedUnconfigured = false;

function storeConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function runCommand(cfg, command) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}

const noopRelease = async () => {};

/**
 * Try to claim `key` for `ttlSeconds`. Resolves to
 *   { claimed: true,  release }  — this caller should send; call release()
 *                                  if the send fails so a retry can claim it
 *   { claimed: false }           — another caller already holds it; skip
 * Never throws.
 */
export async function claimOnce(key, ttlSeconds) {
  const cfg = storeConfig();
  if (!cfg) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('atomicClaim: no KV_REST_API_URL/KV_REST_API_TOKEN configured — email send claims are disabled (falling back to Monday-marker dedupe only).');
    }
    return { claimed: true, release: noopRelease, backend: 'none' };
  }

  const fullKey = `portal:claim:${key}`;
  try {
    const result = await runCommand(cfg, ['SET', fullKey, String(Date.now()), 'NX', 'EX', String(ttlSeconds)]);
    if (result !== 'OK') return { claimed: false, backend: 'redis' };
    return {
      claimed: true,
      backend: 'redis',
      release: async () => {
        try {
          await runCommand(cfg, ['DEL', fullKey]);
        } catch (err) {
          console.warn(`atomicClaim: failed to release ${fullKey} (it will expire on its own):`, err.message);
        }
      },
    };
  } catch (err) {
    console.warn(`atomicClaim: store unavailable for ${fullKey}, proceeding without a claim:`, err.message);
    return { claimed: true, release: noopRelease, backend: 'error' };
  }
}

/** Test-only: reset the one-time "unconfigured" warning. */
export function __resetAtomicClaimForTests() {
  warnedUnconfigured = false;
}
