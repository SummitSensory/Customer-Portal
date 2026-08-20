/**
 * Shared "who actually sent this portal message" logic.
 *
 * Monday.com's create_update API always attributes an update to whoever
 * owns MONDAY_API_TOKEN — never to the actual customer or the specific
 * staff member who typed it into the portal. Confirmed 2026-08-17 against
 * a real order: every message a customer sent through their own portal
 * showed creator "Bryan Shepherd" (the token owner), and every automated
 * tagged update (reminders, contact-update notices, etc.) does too.
 *
 * /api/monday/messages.js fixes this at write time by stamping the true
 * origin into the body itself ([PORTAL:CUSTOMER] / [PORTAL:STAFF]). This
 * file is the single read-time helper both pages/portal/index.js (customer
 * view) and pages/admin/index.js (staff view) use to interpret that tag —
 * previously the admin view didn't use the tag at all and instead guessed
 * from creator.email, which is exactly the field that's always wrong. Keep
 * this the ONE place that decides staff-vs-customer so the two views can't
 * drift out of sync with each other again.
 *
 * Separately, Bryan wants staff-authored messages to always display as
 * "Summit Sensory Gym" — never an individual staff member's name — even in
 * the (rare, direct-Monday-reply) case where creator.name genuinely is a
 * real staff member's name. STAFF_DISPLAY_NAME is the one constant to
 * change if that branding decision ever changes.
 */

export const STAFF_DISPLAY_NAME = 'Summit Sensory Gym';

// Messages posted before this tagging existed (or through/legacy paths that
// never gained a tag) have no [PORTAL:STAFF]/[PORTAL:CUSTOMER] marker at
// all. For those only, fall back to the old creator.email domain guess —
// better than nothing, but never trust it over an explicit tag.
function legacyEmailGuessIsStaff(email) {
  return Boolean(email && (email.includes('summitsensory') || email.includes('summitsensorygym')));
}

/**
 * Was this top-level portal message sent by staff (true) or the customer
 * (false)? Reads the explicit origin tag first; only for untagged legacy
 * history does it fall back to guessing from creator.email.
 */
export function isStaffMessage(msg) {
  if (msg?.body?.includes('[PORTAL:STAFF]')) return true;
  if (msg?.body?.includes('[PORTAL:CUSTOMER]')) return false;
  return legacyEmailGuessIsStaff(msg?.creator?.email);
}

// Threaded replies (Monday's native "reply to an update" feature) never get
// a [PORTAL:*] tag of their own — only top-level portal messages do, at
// send time. In practice a reply is only ever posted by a staff member
// replying directly in Monday, so the email guess is the best signal
// available here; kept as its own named export so both pages read the same
// rule instead of re-deriving it independently.
export function isStaffReply(reply) {
  return legacyEmailGuessIsStaff(reply?.creator?.email);
}

// PORTAL-022: getOrderMessages() (lib/monday.js) returns EVERY update on the
// order item — not just Messages-tab chat, but every internal audit-trail
// tag this app posts (delivery/billing confirmations, reminders, "Staff
// Viewing As Customer" sessions, contact-update requests, invitation-sent
// logs, etc.), all of which are created via Monday's create_update API and
// so all get attributed to the token owner just like real staff chat (see
// this file's top comment). Only a genuine Messages-tab post is tagged with
// the literal `[PORTAL]` prefix at send time (see /api/monday/messages.js);
// every other tagged update uses its own distinct bracketed label (e.g.
// `[PORTAL: Reminder #2]`) which does NOT share this prefix. Use this to
// isolate real chat messages before counting/rendering them as such —
// filtering on this must happen before isStaffMessage() is used to count
// "unread" messages, or every audit-trail entry inflates that count.
export function isPortalChatMessage(msg) {
  return Boolean(msg?.body?.startsWith('[PORTAL]'));
}

// Strips every leading [PORTAL] / [PORTAL:STAFF] / [PORTAL:CUSTOMER] marker
// (and the newline that follows the last one) so staff/customers only ever
// see the actual message text, never the internal routing tags.
export function stripPortalTags(body) {
  if (!body) return '';
  return body.replace(/^(\[PORTAL\]|\[PORTAL:STAFF\]|\[PORTAL:CUSTOMER\])+\n?/, '');
}

/**
 * Display name for a message bubble: staff always shows the company name,
 * never an individual's name; a customer message shows the customer's own
 * name/company, falling back sensibly if some fields are missing.
 */
export function messageDisplayName(staff, order) {
  if (staff) return STAFF_DISPLAY_NAME;
  return order?.pocName || order?.firstName || order?.name || order?.customerEmail || 'Customer';
}
