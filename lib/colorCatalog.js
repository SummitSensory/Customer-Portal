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
function deriveFinish(name) {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1];
}

export const CARDINAL_COLORS = cardinalData.map((d) => ({
  ...d,
  brand: 'cardinal',
  finish: deriveFinish(d.name),
}));

export const PRISMATIC_COLORS = prismaticData.map((d) => ({
  ...d,
  brand: 'prismatic',
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

/**
 * Real, live Monday.com pricing (fixed 2026-08-31, see
 * claude-project-docs/build-and-fix-2026-08-27.md #2): $500 for the first
 * Prismatic selection on an order, $300 for each additional one. This
 * replaced an earlier flat "$350" figure that only existed in the
 * pre-08-31 mockup — the mockup's number must not be reused.
 */
export const PRISMATIC_UPCHARGE = { first: 500, additional: 300 };

export function prismaticUpcharge(prismaticSelectionCount) {
  if (prismaticSelectionCount <= 0) return 0;
  return PRISMATIC_UPCHARGE.first + PRISMATIC_UPCHARGE.additional * (prismaticSelectionCount - 1);
}
