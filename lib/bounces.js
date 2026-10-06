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

/** Has `email` bounced (or complained) on this order, per its update history? */
export function hasBounced(updates, email) {
  const addr = (email || '').trim().toLowerCase();
  if (!addr) return false;
  return (updates || []).some(u => {
    const body = (u.body || '').toLowerCase();
    return body.startsWith(`[${BOUNCE_TAG.toLowerCase()}]`) && body.includes(addr);
  });
}
