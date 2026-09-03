import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCardinalHtml, diffCardinalCatalog } from './colorCatalogSync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A real snapshot of http://www.cardinalpaint.com/powder/color-chart/,
// fetched and saved 2026-09-01 — not synthetic markup. Tests the parser
// against Cardinal's actual page structure, independent of the live site's
// current state (a real fetch is exercised separately, manually, not in CI).
const FIXTURE = fs.readFileSync(
  path.join(__dirname, '..', '__tests__', 'fixtures', 'cardinal-color-chart-2026-09-01.html'),
  'utf8'
);

describe('parseCardinalHtml — element-boundary attribution (regression, found in code review 2026-09-01)', () => {
  // Reproduces the exact bug shape directly, rather than relying on the
  // real fixture's incidental properties: an unrelated <li> (Cardinal's own
  // nav menu, in real life) sits before the actual color tile in the raw
  // HTML. The old unscoped regex would pair THIS li's class with the real
  // tile's name/code — silently dropping the "Primer" tag and letting an
  // excluded color slip through as included.
  const SYNTHETIC = `
    <ul class="nav">
      <li class="utility-link link Medium button">Contact Us</li>
    </ul>
    <ul class="colorTiles">
      <li class="Cardinal Primer colorTile colorid-66 filtered-item">
        <span class="Title">Grey Primer</span>
        <span class="ProductCode">T012-GR900</span>
      </li>
      <li class="Cardinal Blue colorTile colorid-32 filtered-item">
        <span class="Title">Blue 90 Gloss</span>
        <span class="ProductCode">T009-BL01</span>
      </li>
    </ul>
  `;

  it('attributes the Primer tile\'s OWN class to it, not the preceding unrelated <li>\'s class', () => {
    const parsed = parseCardinalHtml(SYNTHETIC);
    const primerEntry = parsed.find((e) => e.code === 'T012-GR900');
    expect(primerEntry?.name).toBe('Grey Primer');
    expect(primerEntry?.excluded).toBe(true); // this is the assertion the old regex silently failed
  });

  it('still correctly parses the real color tile that follows the mismatched one', () => {
    const parsed = parseCardinalHtml(SYNTHETIC);
    const blueEntry = parsed.find((e) => e.code === 'T009-BL01');
    expect(blueEntry?.name).toBe('Blue 90 Gloss');
    expect(blueEntry?.excluded).toBe(false);
  });

  it('never emits an entry for the unrelated leading <li> itself', () => {
    const parsed = parseCardinalHtml(SYNTHETIC);
    expect(parsed.length).toBe(2);
  });
});

describe('parseCardinalHtml — against a real saved snapshot of the live page', () => {
  const parsed = parseCardinalHtml(FIXTURE);

  it('the very first parsed entry is the real first color tile, not a misattributed nav element (this exact case is what code review caught)', () => {
    expect(parsed[0]?.code).toBe('P009-RD02');
    expect(parsed[0]?.name).toBe('Dark Red 90 Gloss');
    expect(parsed[0]?.excluded).toBe(false);
  });

  it('finds all 136 colors on the real page (131 included + 5 excluded)', () => {
    expect(parsed.length).toBe(136);
  });

  it('excludes exactly the 5 previously-documented Primer/Exterior colors', () => {
    const excluded = parsed.filter((e) => e.excluded);
    expect(excluded.length).toBe(5);
  });

  it('the included count matches the real, already-verified dataset size (131)', () => {
    expect(parsed.filter((e) => !e.excluded).length).toBe(131);
  });

  it('correctly excludes "Copper Vein Exterior" by name, not a CSS class', () => {
    const entry = parsed.find((e) => e.name === 'Copper Vein Exterior');
    expect(entry?.excluded).toBe(true);
  });

  it('correctly excludes Primer-tagged tiles', () => {
    const primerNames = parsed.filter((e) => e.excluded && e.name !== 'Copper Vein Exterior');
    expect(primerNames.length).toBe(4);
  });

  it('finds a known real color unchanged from the original dataset', () => {
    const entry = parsed.find((e) => e.code === 'P004-BR23');
    expect(entry?.name).toBe('Bronze 40 Gloss');
    expect(entry?.excluded).toBe(false);
  });
});

describe('diffCardinalCatalog — against the real stored dataset', () => {
  it('reports zero drift right now — the stored dataset was built from this same live page', () => {
    const parsed = parseCardinalHtml(FIXTURE);
    const diff = diffCardinalCatalog(parsed);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.liveCount).toBe(131);
    expect(diff.storedCount).toBe(131);
  });

  it('detects a genuinely new color', () => {
    const parsed = parseCardinalHtml(FIXTURE);
    parsed.push({ name: 'Brand New Color 50 Gloss', code: 'ZZZ-9999', excluded: false });
    const diff = diffCardinalCatalog(parsed);
    expect(diff.added.map((e) => e.code)).toContain('ZZZ-9999');
  });

  it('detects a color removed from the live page', () => {
    const parsed = parseCardinalHtml(FIXTURE).filter((e) => e.code !== 'P004-BR23');
    const diff = diffCardinalCatalog(parsed);
    expect(diff.removed.map((e) => e.code)).toContain('P004-BR23');
  });

  it('detects a renamed color (same code, different name)', () => {
    const parsed = parseCardinalHtml(FIXTURE).map((e) =>
      e.code === 'P004-BR23' ? { ...e, name: 'Renamed Bronze' } : e
    );
    const diff = diffCardinalCatalog(parsed);
    expect(diff.changed.map((e) => e.code)).toContain('P004-BR23');
  });

  it('never treats zero parsed colors as a valid diff — that path throws in syncCardinalCatalog instead', () => {
    // Guards the "page structure changed, parser silently returns nothing"
    // failure mode explicitly — see syncCardinalCatalog()'s own check.
    const diff = diffCardinalCatalog([]);
    expect(diff.liveCount).toBe(0);
    expect(diff.removed.length).toBe(131); // every stored color would look "removed" — a red flag, not a real catalog change
  });
});
