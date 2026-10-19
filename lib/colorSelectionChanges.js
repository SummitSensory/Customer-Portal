/**
 * Staff color-selection overrides: what changed, and the audit trail.
 *
 * Bryan, 2026-10-19: customers can't change colors once confirmed, so staff
 * need to override a confirmed (or on-file) selection from the portal, with
 * an email to the team and the customer, the change written onto the same
 * order / color-board rows, and an audit trail of every change.
 *
 * The audit trail is Monday updates on the order, not the snapshot column:
 * "Portal: Color Selection Answers (JSON)" is long text, capped at 2,000
 * characters by Monday, and real snapshots already run ~900 — a history kept
 * there would overflow after a change or two (and ssg-cpq-app parses it).
 * Updates are permanent, timestamped, and where every other portal action is
 * already recorded.
 */

import { describeSelection } from './colorCatalog';
import { PART_LABELS } from './colorRequirements';

export const COLOR_CONFIRMED_TAG = 'PORTAL: Color Selections';
export const COLOR_CHANGED_TAG = 'PORTAL: Color Selections Changed';

function sameSelection(a, b) {
  return (a?.brand || null) === (b?.brand || null) && (a?.code || null) === (b?.code || null);
}

/**
 * Every part on the order's checklist whose pick differs between `before`
 * and `after`, in checklist order. `from` is null when there was no portal
 * pick before (colors that came in through Jotform).
 */
export function diffSelections(requiredInputs, before, after) {
  const changes = [];
  for (const input of requiredInputs || []) {
    for (const part of input.parts) {
      const prev = before?.[input.input]?.[part] || null;
      const next = after?.[input.input]?.[part] || null;
      if (sameSelection(prev, next)) continue;
      changes.push({
        input: input.input,
        inputLabel: input.label,
        part,
        partLabel: PART_LABELS[part] || part,
        from: prev ? describeSelection(prev).label : null,
        to: next ? describeSelection(next).label : null,
      });
    }
  }
  return changes;
}

/** "Structure & Frame Paint — Legs: Black (T009-BL01) → Navy (T009-BL05)" */
export function changeLine(change) {
  return `${change.inputLabel} — ${change.partLabel}: ${change.from || 'not picked in the portal'} → ${change.to || 'none'}`;
}

function money(n) {
  return `$${(Number(n) || 0).toLocaleString()}`;
}

/** "$0 → $500 (+$500)", or "$500 (unchanged)". */
export function upchargeChangeText(previousTotal, newTotal) {
  if (previousTotal === null || previousTotal === undefined) return `${money(newTotal)} (no earlier portal total)`;
  const diff = (Number(newTotal) || 0) - (Number(previousTotal) || 0);
  if (!diff) return `${money(newTotal)} (unchanged)`;
  return `${money(previousTotal)} → ${money(newTotal)} (${diff > 0 ? '+' : '−'}${money(Math.abs(diff))})`;
}

/** Body of the audit-trail update posted on the order for one override. */
export function overrideAuditText({ staffEmail, reason, changes, previousTotal, newTotal, at = new Date() }) {
  return [
    `Changed by staff ${staffEmail} in the customer portal on ${at.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.`,
    `Reason: ${reason}`,
    ...changes.map(changeLine),
    `Color upcharge: ${upchargeChangeText(previousTotal, newTotal)}`,
  ].join('\n');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The order's color audit trail, newest first, from its Monday updates:
 * every confirmation (portal or Jotform), auto-N/A, and staff override.
 */
export function colorHistoryFromUpdates(updates) {
  const entries = [];
  for (const u of updates || []) {
    const text = htmlToText(u.body).trim();
    const kind = text.startsWith(`[${COLOR_CHANGED_TAG}]`) ? 'changed'
      : text.startsWith(`[${COLOR_CONFIRMED_TAG}]`) ? 'confirmed'
        : null;
    if (!kind) continue;
    const lines = text.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    entries.push({ id: String(u.id), at: u.created_at, kind, lines });
  }
  return entries.sort((a, b) => new Date(b.at) - new Date(a.at));
}
