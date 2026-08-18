/**
 * Sanitize HTML before rendering via dangerouslySetInnerHTML.
 *
 * PORTAL-002: order message bodies (the customer/staff messaging thread —
 * pages/portal/index.js and pages/admin/index.js) were rendered with
 * dangerouslySetInnerHTML and ZERO sanitization. Message bodies can contain
 * genuinely useful formatting (staff can bold/link/paragraph-format replies
 * via Monday.com's own update editor, which returns real HTML from Monday's
 * API), so the fix is to sanitize rather than strip to plain text — anyone
 * who can post a message (a logged-in customer, or the Jotform-style
 * unauthenticated paths feeding into it) previously had a stored-XSS
 * primitive against every staff member and customer who opened that order's
 * Messages tab.
 *
 * Only usable in the browser — DOMPurify needs a real DOM (or jsdom) to
 * operate. These pages fetch messages client-side after mount (no
 * getServerSideProps), so message bodies are never present during the
 * server-rendered pass — returning '' server-side is a safe fallback, not a
 * functional gap for this app's actual data flow.
 */
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'a', 'ul', 'ol', 'li', 'span'];
const ALLOWED_ATTR = ['href'];

let hooked = false;
function ensureLinkSafetyHook() {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  // Force every surviving <a> to open safely regardless of what attributes
  // the source HTML specified — prevents tabnabbing via target=_blank
  // without rel=noopener, and blocks non-http(s) href schemes (javascript:,
  // data:, etc.) that ALLOWED_ATTR alone wouldn't filter by value.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) {
        node.removeAttribute('href');
      } else {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

/** Sanitize a message body HTML string down to a small safe formatting subset. */
export function sanitizeMessageHtml(html) {
  if (typeof window === 'undefined') return '';
  ensureLinkSafetyHook();
  return DOMPurify.sanitize(html || '', { ALLOWED_TAGS, ALLOWED_ATTR });
}
