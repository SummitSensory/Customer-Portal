/**
 * Bounced / spam-complaint customer addresses, recorded on the order itself
 * as a tagged update by pages/api/resend/webhook.js. Before this, a dead
 * address was invisible: Scarborough Public Schools' invite and every
 * reminder bounced (2026-09-28 → 10-05) and nobody knew the customer had
 * never received a single portal email.
 *
 * The tag names the address, so once staff correct the order's customer
 * email the old bounce no longer applies and reminders resume on their own.
 */

export const BOUNCE_TAG = 'PORTAL: Email Bounced';

// AUDIT-2026-10-06: characters that can be part of an email address. The
// address must not be touching one of these on either side, so a bounce for
// "jbob@x.org" no longer counts as a bounce for "bob@x.org" (nor
// "bob@x.org.uk" for "bob@x.org") — a plain substring match paused reminders
// to a perfectly good address.
const EMAIL_CHAR = /[a-z0-9.!#$%&'*+/=?^_`{|}~@-]/i;

function containsAddress(body, addr) {
  let from = 0;
  for (;;) {
    const at = body.indexOf(addr, from);
    if (at < 0) return false;
    const before = at > 0 ? body[at - 1] : '';
    const after = body[at + addr.length] || '';
    // A trailing "." is sentence punctuation ("… to bob@x.org."), not part
    // of a longer address, unless an address character follows it.
    const afterIsAddressChar = after === '.'
      ? EMAIL_CHAR.test(body[at + addr.length + 1] || '')
      : EMAIL_CHAR.test(after);
    if (!EMAIL_CHAR.test(before) && !afterIsAddressChar) return true;
    from = at + 1;
  }
}

/** Has `email` bounced (or complained) on this order, per its update history? */
export function hasBounced(updates, email) {
  const addr = (email || '').trim().toLowerCase();
  if (!addr) return false;
  return (updates || []).some(u => {
    const body = (u.body || '').toLowerCase();
    return body.startsWith(`[${BOUNCE_TAG.toLowerCase()}]`) && containsAddress(body, addr);
  });
}
