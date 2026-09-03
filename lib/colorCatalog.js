/**
 * Structure & Frame Paint color catalogs — Cardinal and Prismatic.
 *
 * Sourced from Cowork's verified data-gathering work (see
 * claude-project-docs/color-selection-redesign-proposal-2026-08-22.md,
 * 2026-08-26 entries): Cardinal's 131 colors were pulled directly from
 * cardinalpaint.com's own color-chart page with a pixel-sampled hex per
 * photo; Prismatic's 428 colors were pulled from prismaticpowders.com with
 * no photos available (their CDN blocks hotlinking), so those are shown as
 * verified swatches only.
 *
 * Every entry carries a `provenance` field so nothing unsourced can ever be
 * shown to a customer (see the Color Selection Experience doc, §03) — this
 * dataset is 100% real, but the field stays load-bearing for future catalog
 * additions that may not be.
 */
import cardinalData from './data/cardinalColors.json';
import prismaticData from './data/prismaticColors.json';
import vinylData from './data/vinylColors.json';

// Cardinal's own naming convention states the finish type as the last word
// of the color name ("... Gloss", "... Texture", "... Hammer", etc.) —
// same derivation Cowork's original picker used, carried forward verbatim.
// Exported so lib/colorCatalogSync.js can reuse this exact rule (its own
// isExterior check needs it) instead of keeping a second, separately
// maintained copy — a real duplication a code review flagged, since the
// two could silently drift if this rule ever changed in only one place.
export function deriveFinish(name) {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1];
}

export const CARDINAL_COLORS = cardinalData.map((d) => ({
  ...d,
  brand: 'cardinal',
  finish: deriveFinish(d.name),
}));

// Verified directly against Prismatic's own live site (prismaticpowders.com
// /shop/powder-coating-colors, fetched 2026-09-02): its real "Finish" filter
// has exactly 7 values — Solid Tone, Transparent, Metallic, Texture, River,
// Vein, Wrinkle — plus RAL as its own real, distinct category (170 of our
// 428 SKUs literally start "RAL-"). Direct requirement from Bryan
// (2026-09-02): "the finishes are often in the name... see if you can
// determine based on the data."
//
// Checked what's actually IN our stored names/SKUs (not guessed): "River"
// and "RAL" are the only two of those 8 categories that appear anywhere —
// zero of the other 6 keywords (Solid Tone, Transparent, Metallic, Texture,
// Vein, Wrinkle) occur in any of the 428 names. Every RAL-prefixed SKU's
// name also happens to contain "River" (170 of 170), so RAL is checked
// first and wins over the River match.
//
// The remaining 50 colors (neither RAL nor "River" in the name) have NO
// real signal to classify by — and a live spot-check (searching Prismatic's
// current site for one of them, "Black Rock" / PRB-1019) found no matching
// product at all under that name. This dataset was pulled from Prismatic's
// old River-line catalog page (see lib/colorCatalogSync.js's header comment
// — that page 404s today), and these 50 SKU prefixes (PRB/PRS/HRB/URB/PLB/
// ERB) don't match the live site's current prefix scheme (PSS/PMS/PTB/etc.
// observed live), so there's no reliable way to look their real finish up
// either. finish is left null rather than guessed — never fabricate a
// customer-facing classification with zero underlying evidence (see this
// module's header on provenance).
function derivePrismaticFinish(d) {
  if (d.sku.startsWith('RAL-')) return 'RAL';
  if (d.name.includes('River')) return 'River';
  return null;
}

export const PRISMATIC_COLORS = prismaticData.map((d) => ({
  ...d,
  brand: 'prismatic',
  finish: derivePrismaticFinish(d),
}));

// Mat/pad vinyl colors, pixel-sampled from real supplier-photo swatches
// provided directly by Bryan (2026-09-01) — same rigor as Cardinal (real
// photo -> real average hex, not eyeballed), matching every name already
// used on the R board (8047969422). No brand/upcharge concept here, unlike
// Structure & Frame Paint. "Refer to Notes" (a free-text catch-all on the R
// board, not an actual color) is intentionally not part of this catalog.
export const VINYL_COLORS = vinylData.map((d) => ({
  ...d,
  brand: 'vinyl',
}));

const VERIFIED_PROVENANCE = new Set(['photo-verified', 'swatch-verified']);

/** Never returns a color that isn't actually sourced/verified. */
function onlyVerified(list) {
  return list.filter((c) => VERIFIED_PROVENANCE.has(c.provenance));
}

export function listCardinalColors() {
  return onlyVerified(CARDINAL_COLORS);
}

export function listPrismaticColors() {
  return onlyVerified(PRISMATIC_COLORS);
}

export function listVinylColors() {
  return onlyVerified(VINYL_COLORS);
}

// Cardinal's own published names sometimes lead with an external standard
// reference — Federal Standard ("FS 33446"), RAL ("RAL 8028"), or ANSI
// ("ANSI 61") — ahead of the descriptive color name itself. That's real,
// verified content pulled directly from cardinalpaint.com (see this
// module's header), not a data error, so it's kept as-is on every color
// object's `name` field. But visually it reads exactly like a code
// smashed into the name — direct customer feedback (2026-09-02, after the
// first title-casing pass) confirmed it still read that way. displayName()
// strips that leading token for the customer-facing label only; nothing is
// deleted — standardDesignation() below recovers it so it can be shown as
// its own separate reference line instead of buried in the name.
const STANDARD_PREFIX_RE = /^(FS\s*\d+|RAL\s*\d+|ANSI\s*\d+)\s+/i;

function stripStandardPrefix(name) {
  return name.replace(STANDARD_PREFIX_RE, '').trim();
}

// Both Cardinal AND Prismatic reuse an identical display name across
// distinct SKUs — confirmed real for both, not just Cardinal (2026-09-02):
// Cardinal has 16 names covering 39 of 131 colors (e.g. two separate
// "Black Flat" powders, E300-BK11 vs E300-BK147). Prismatic has a much
// bigger single collision: all 170 RAL-prefixed colors are named "Ral ####
// River" — stripStandardPrefix (below) strips the leading "Ral ####" the
// same way it strips Cardinal's FS/RAL/ANSI tokens, so all 170 collapse to
// the identical stripped name "River" with nothing to tell them apart.
// This MUST be scoped per-brand (not a single global count): Cardinal's
// `code` and Prismatic's `sku` are different ID spaces, so counting across
// both brands together risks a false "collision" between, say, a Cardinal
// color and an unrelated Prismatic color that merely happen to share a
// stripped name. Computed once from each full catalog (not per-render),
// keyed on the STRIPPED name since that's the string actually shown. Built
// from listCardinalColors()/listPrismaticColors() (verified-only), NOT the
// raw CARDINAL_COLORS/PRISMATIC_COLORS arrays — found by independent code
// review (2026-09-03): using the raw arrays meant a future unverified
// catalog entry (e.g. one lib/colorCatalogSync.js's cron adds before its
// photo is pixel-sampled — see that module's own documented workflow)
// could pollute this collision count and trigger a spurious "(code)"
// suffix on an already-shown VERIFIED color with the same stripped name,
// even though onlyVerified() hides the unverified entry from every list a
// customer can actually see. Currently dormant (every entry today is
// verified) but a real gap in the invariant this module's header
// establishes.
function buildNameCounts(colors) {
  return colors.reduce((counts, c) => {
    const key = stripStandardPrefix(c.name);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

const NAME_COUNTS_BY_BRAND = {
  cardinal: buildNameCounts(listCardinalColors()),
  prismatic: buildNameCounts(listPrismaticColors()),
};

export function displayColorName(color) {
  if (!color?.name) return color?.name || '';
  const stripped = stripStandardPrefix(color.name);
  const id = color.code || color.sku;
  const counts = NAME_COUNTS_BY_BRAND[color.brand];
  if (id && counts?.[stripped] > 1) {
    // Cardinal's code (e.g. "E300-BK11") and Prismatic's RAL sku (e.g.
    // "RAL-7035-RIVER") both carry their real distinguishing value as the
    // middle "-"-separated segment — for RAL specifically this is the
    // actual RAL number, a meaningful disambiguator on its own ("River
    // (7035)" vs "River (9005)"), not just an opaque code fragment.
    const suffix = id.split('-')[1] || id;
    return `${stripped} (${suffix})`;
  }
  return stripped;
}

export function standardDesignation(color) {
  const match = color?.name?.match(STANDARD_PREFIX_RE);
  return match ? match[1].trim().toUpperCase().replace(/\s+/, ' ') : null;
}

export function findCardinalByCode(code) {
  return listCardinalColors().find((c) => c.code === code) || null;
}

export function findPrismaticBySku(sku) {
  return listPrismaticColors().find((c) => c.sku === sku) || null;
}

export function findVinylByName(name) {
  return listVinylColors().find((c) => c.name === name) || null;
}

export function cardinalFinishes() {
  return [...new Set(listCardinalColors().map((c) => c.finish))].sort();
}

export function prismaticFamilies() {
  return [...new Set(listPrismaticColors().map((c) => c.family))].sort();
}

// Excludes null (the ~50 colors with no verifiable finish — see
// derivePrismaticFinish's header) from the filter's own option list: there's
// nothing a customer could meaningfully pick "unknown" for. Those colors
// still show up under "All finishes" (the unfiltered default) same as any
// other — they're just not excludable/includable by a finish they don't
// have real data for.
export function prismaticFinishes() {
  return [...new Set(listPrismaticColors().map((c) => c.finish).filter(Boolean))].sort();
}

/**
 * Real, live Monday.com pricing (fixed 2026-08-31, see
 * claude-project-docs/build-and-fix-2026-08-27.md #2): $500 for the first
 * Prismatic selection on an order, $300 for each additional one. This
 * replaced an earlier flat "$350" figure that only existed in the
 * pre-08-31 mockup — the mockup's number must not be reused.
 */
export const PRISMATIC_UPCHARGE = { first: 500, additional: 300 };

/**
 * Resolves a stored {brand, code} selection back to its real catalog entry.
 * Extracted here (2026-09-01, code review finding) after the identical
 * if/else chain was independently reimplemented three times —
 * ColorSelectionTab.js (twice) and pages/admin/index.js — with nothing
 * composing lib/colorCatalog.js's own find*By* functions into one lookup.
 * Returns null for an unrecognized/missing selection rather than throwing.
 */
export function resolveSelectedColor(selection) {
  if (!selection) return null;
  if (selection.brand === 'cardinal') return findCardinalByCode(selection.code);
  if (selection.brand === 'prismatic') return findPrismaticBySku(selection.code);
  if (selection.brand === 'vinyl') return findVinylByName(selection.code);
  return null;
}

/**
 * Finds every real {inputKey, part, color} in `selections` that ISN'T
 * covered by `requiredInputs` — the order's CURRENT productType shape.
 * requiredInputs comes from a live server call keyed on productType (see
 * lib/colorRequirements.js); if productType is edited after a customer
 * already confirmed, their real selections are still sitting in the
 * snapshot under the OLD productType's part keys (Adventure Series's
 * `legs`/`horizontal_beams`/etc. are entirely different keys from Soar's
 * `soar_frame` or Flex's `flex_frame`), which don't match ANY part in the
 * new requiredInputs — every consumer that only ever walks requiredInputs
 * to know what to render would show nothing at all for a real, paid,
 * confirmed order. Found independently, twice, in the same review pass
 * (2026-09-02): first in pages/admin/index.js's staff-facing detail panel,
 * then again in this exact same shape in the CUSTOMER's own locked
 * ConfirmedView — extracted here once both call sites needed the
 * identical scan, instead of letting a third copy exist.
 */
export function findOrphanedSelections(requiredInputs, selections) {
  const known = new Set();
  (requiredInputs || []).forEach((input) => input.parts.forEach((part) => known.add(`${input.input}.${part}`)));

  const orphans = [];
  for (const inputKey of Object.keys(selections || {})) {
    for (const partKey of Object.keys(selections[inputKey] || {})) {
      if (known.has(`${inputKey}.${partKey}`)) continue;
      const color = resolveSelectedColor(selections[inputKey][partKey]);
      if (color) orphans.push({ inputKey, partKey, color });
    }
  }
  return orphans;
}

/**
 * Per-line pricing for a summary/review screen: walks every required part
 * in a stable order and assigns real dollar amounts — $500 to the FIRST
 * *uniquely different* Prismatic color encountered, $300 to each
 * additional *uniquely different* one after that, $0 to everything else
 * (Cardinal, vinyl, and any repeat use of a Prismatic color already
 * charged for on an earlier part). Direct requirement (2026-09-02): a
 * customer picking the same Prismatic color for more than one part of the
 * frame is only paying for that color once, not once per part — the
 * upcharge is per unique color choice, not per part. Uniqueness is keyed
 * on the Prismatic SKU (`code`), the real catalog identity, never the
 * display name (two different SKUs can share a name — see
 * displayColorName's own header). The order is simply iteration order over
 * requiredInputs/parts, which is the same order the picker itself presents
 * them in, so "first" here matches what a customer would actually perceive
 * as first.
 *
 * computeTotalUpcharge (lib/colorSelectionValidation.js) is the
 * server-authoritative aggregate; this is the client-facing breakdown of
 * exactly how that total is made up. They're guaranteed to agree because
 * the aggregate is a straight sum of these same per-line amounts — added
 * 2026-09-01 (code review had flagged the two being computed by separate,
 * independently-written loops that could drift).
 */
export function computeLineItemPricing(requiredInputs, selections) {
  let uniquePrismaticCount = 0;
  const pricedPrismaticCodes = new Set();
  const lines = [];
  for (const input of requiredInputs || []) {
    for (const part of input.parts) {
      const selection = selections?.[input.input]?.[part];
      let amount = 0;
      if (selection?.brand === 'prismatic' && !pricedPrismaticCodes.has(selection.code)) {
        pricedPrismaticCodes.add(selection.code);
        uniquePrismaticCount++;
        amount = uniquePrismaticCount === 1 ? PRISMATIC_UPCHARGE.first : PRISMATIC_UPCHARGE.additional;
      }
      lines.push({
        inputKey: input.input,
        inputLabel: input.label,
        part,
        selection: selection || null,
        color: resolveSelectedColor(selection),
        amount,
      });
    }
  }
  return lines;
}
