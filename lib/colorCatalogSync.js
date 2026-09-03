/**
 * Scheduled re-pull of Cardinal's color-chart page so new/changed/retired
 * colors don't sit undetected — the requirement Bryan asked for directly
 * (2026-09-01): "there needs to be a schedule of the frequency that the
 * software will go back and repull the information to see if anything new
 * has been added."
 *
 * Cardinal only: verified live against the real page
 * (http://www.cardinalpaint.com/powder/color-chart/, fetched and inspected
 * directly this session — plain server-rendered HTML, 136 colors, `.Title`/
 * `.ProductCode` spans exactly as Cowork's original data-gathering
 * described). Primer and Exterior-finish colors are excluded, matching the
 * same rule the original catalog build used (Primer via the tile's own
 * `Primer` class; Exterior via the color's own name ending in "Exterior",
 * e.g. "Copper Vein Exterior" — there is no separate Exterior CSS class).
 *
 * Prismatic is DELIBERATELY NOT implemented here — checked directly this
 * session, not assumed: prismaticpowders.com has been restructured since
 * Cowork's 2026-08-25 data pull. The old `/colors/river/` path 404s, and
 * the current `/shop/powder-coating-colors` listing is a client-rendered
 * Next.js storefront — a plain HTTP fetch returns almost no SKU data (8
 * matches in 1.2MB), meaning the colors load via client-side JS/API calls
 * a server-side cron can't reach the same way. Shipping a Prismatic
 * "sync" against that would silently do nothing while reporting success —
 * exactly the failure class this codebase has been bitten by before.
 * syncCardinalCatalog() reports this explicitly rather than pretending
 * Prismatic is covered.
 */

import cardinalData from './data/cardinalColors.json';
import { deriveFinish } from './colorCatalog';

export const CARDINAL_COLOR_CHART_URL = 'http://www.cardinalpaint.com/powder/color-chart/';

/**
 * Parses Cardinal's color-chart HTML into {name, code, excluded} entries.
 * Exported separately from the network fetch so it's unit-testable against
 * a real saved fixture, without hitting the live site in tests.
 */
export function parseCardinalHtml(html) {
  const results = [];
  // FIXED (found in independent code review, 2026-09-01): the gap between
  // `<li class="...">` and the Title span used to be an unscoped `[\s\S]*?`,
  // which could (and, verified against the real page, did) skip straight
  // past OTHER <li> elements — e.g. Cardinal's own nav-menu items, which sit
  // earlier in the raw HTML than the color grid — and pair the WRONG
  // element's class list with a real color's name/code. `(?:(?!<li)[\s\S])*?`
  // fixes this the direct way: it refuses to consume a `<li` at all, so a
  // match can only complete if the Title/ProductCode spans are found before
  // the next list item starts. If they're not (i.e. this <li> isn't a real
  // color tile), the match attempt fails outright and the scan moves on to
  // the next real `<li class="...">` instead of silently misattributing.
  const tileRe = /<li class="([^"]*)">(?:(?!<li)[\s\S])*?<span class="Title">([^<]+)<\/span>\s*<span class="ProductCode">([^<]+)<\/span>/g;
  let m;
  while ((m = tileRe.exec(html)) !== null) {
    const [, classList, rawName, rawCode] = m;
    const name = rawName.trim();
    // A handful of metallic/specialty finishes carry a trailing footnote
    // marker in the raw HTML ("C356-GR1342 *" — the page's own footnote:
    // "* To maintain the appearance of exterior metallic finishes a clear
    // topcoat is recommended"). That's an annotation, not part of the real
    // product code — confirmed against the color's own image filename
    // (/assets/colors/C356-GR1342.jpg, no asterisk) in the same HTML block.
    const code = rawCode.trim().replace(/\s*\*+\s*$/, '');
    const isPrimer = classList.split(/\s+/).includes('Primer');
    const isExterior = deriveFinish(name) === 'Exterior';
    results.push({ name, code, excluded: isPrimer || isExterior });
  }
  return results;
}

export async function fetchCardinalCatalogHtml() {
  const res = await fetch(CARDINAL_COLOR_CHART_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Cardinal color-chart page returned ${res.status}`);
  return res.text();
}

/**
 * Compares the live catalog against what's stored in lib/data/cardinalColors.json,
 * by code. Returns which codes are new, which disappeared, and which changed
 * name — never auto-applies a change (a new code has no real hex/photo yet;
 * that still requires the same pixel-sampling process the original catalog
 * used, run manually/via Cowork, not blindly inferred by a cron).
 */
export function diffCardinalCatalog(liveEntries) {
  const live = liveEntries.filter((e) => !e.excluded);
  const liveByCode = new Map(live.map((e) => [e.code, e]));
  const storedByCode = new Map(cardinalData.map((e) => [e.code, e]));

  const added = live.filter((e) => !storedByCode.has(e.code));
  const removed = cardinalData.filter((e) => !liveByCode.has(e.code));
  // Case-insensitive: 47 of the 131 stored names are in inconsistent
  // casing from the original extraction (e.g. stored "BLUE 90 GLOSS" vs.
  // live "Blue 90 Gloss") — confirmed pre-existing, not a live content
  // change. Comparing case-sensitively would report ~a third of the
  // catalog as "renamed" on every single run, which would train whoever
  // reads the alert to ignore it — exactly the failure mode a sync job
  // like this exists to prevent. A real rename still gets caught.
  const changed = live.filter((e) => {
    const stored = storedByCode.get(e.code);
    return stored && stored.name.toLowerCase() !== e.name.toLowerCase();
  });

  return { added, removed, changed, liveCount: live.length, storedCount: cardinalData.length };
}

export async function syncCardinalCatalog() {
  const html = await fetchCardinalCatalogHtml();
  const parsed = parseCardinalHtml(html);
  if (parsed.length === 0) {
    // The page loaded but nothing matched — almost certainly means
    // Cardinal changed their markup, not that they have zero colors.
    // Treat this as a failure, not "0 colors found," so it alerts instead
    // of silently wiping the catalog on the next manual review.
    throw new Error('Cardinal color-chart page returned no parseable color tiles — the page structure may have changed.');
  }
  const diff = diffCardinalCatalog(parsed);
  return {
    ...diff,
    prismaticSynced: false,
    prismaticNote: 'Prismatic sync not implemented — prismaticpowders.com is now a client-rendered storefront a server fetch cannot scrape. See lib/colorCatalogSync.js header comment.',
  };
}
