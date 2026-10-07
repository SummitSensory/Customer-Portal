/**
 * AUDIT-2026-10-06: staff-entered Monday.com URLs (installation links/docs/
 * videos, invoice link, payment link, file public_urls) were rendered
 * straight into href/src. React does not block `javascript:` URLs in href
 * (it only warns), and a `data:`/`vbscript:` value is equally unwanted — a
 * typo'd or tampered Monday column could turn a portal link into script
 * execution in the customer's session. Only absolute http(s) URLs are ever
 * rendered; anything else returns null so callers can skip it.
 *
 * Lives in components/ (not lib/) because it is shared by the portal and
 * admin pages only — no server code renders these URLs.
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null; // relative / scheme-less / malformed — never a real external link
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return trimmed;
}
