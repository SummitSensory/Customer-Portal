/**
 * Allowlist HTML sanitizer + URL scheme validator for the email template
 * system. Used for the `raw_html` block type (the "advanced mode" escape
 * hatch) — every other block type in blocks.js produces markup structurally
 * and never needs sanitizing in the first place.
 *
 * NOTE: this is a minimal, dependency-free allowlist — good enough as a first
 * pass while the app has zero content-sanitization dependencies today, but it
 * has not had adversarial security review. Swap in a maintained library (e.g.
 * `sanitize-html`) before the raw_html block type is exposed to real admins.
 */

const ALLOWED_TAGS = new Set([
  'p', 'b', 'strong', 'i', 'em', 'a', 'ul', 'ol', 'li', 'br', 'span', 'div',
  'table', 'tbody', 'tr', 'td', 'h1', 'h2', 'h3',
]);
const ALLOWED_ATTRS = new Set(['href', 'style', 'align', 'width', 'cellpadding', 'cellspacing', 'border']);
const SAFE_URL_SCHEMES = ['https:', 'mailto:', 'tel:'];

export function isSafeUrl(url) {
  if (!url) return false;
  try {
    if (url.startsWith('/')) return true; // relative/portal-internal path
    const parsed = new URL(url);
    return SAFE_URL_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function sanitizeHtml(html) {
  if (!html) return '';
  let out = html;

  // Drop dangerous elements entirely, open+content+close and self-closing forms.
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|svg)[^>]*\/?>/gi, '');

  // Strip every event-handler attribute (onclick, onerror, onload, ...).
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Rewrite opening tags to only the allowlisted tag + attributes.
  out = out.replace(/<([a-zA-Z0-9]+)((?:\s+[^>]*)?)>/g, (match, tag, attrs) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return '';
    const cleaned = (attrs.match(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*')/g) || [])
      .filter(a => ALLOWED_ATTRS.has(a.split('=')[0].trim().toLowerCase()))
      .filter(a => {
        if (!a.toLowerCase().startsWith('href')) return true;
        const value = a.split('=').slice(1).join('=').replace(/^["']|["']$/g, '');
        return isSafeUrl(value);
      })
      .join(' ');
    return `<${tag}${cleaned ? ' ' + cleaned : ''}>`;
  });

  // Drop closing tags for anything not on the allowlist too.
  out = out.replace(/<\/([a-zA-Z0-9]+)>/g, (match, tag) => (ALLOWED_TAGS.has(tag.toLowerCase()) ? match : ''));

  return out;
}
