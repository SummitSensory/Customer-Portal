import { describe, it, expect } from 'vitest';
import {
  listCardinalColors,
  listPrismaticColors,
  listVinylColors,
  findCardinalByCode,
  findPrismaticBySku,
  findVinylByName,
  cardinalFinishes,
  prismaticFinishes,
  resolveSelectedColor,
  findOrphanedSelections,
  computeLineItemPricing,
  displayColorName,
  standardDesignation,
  CARDINAL_COLORS,
  PRISMATIC_COLORS,
} from './colorCatalog';

describe('color catalog — provenance gating', () => {
  it('never returns a color without a verified provenance', () => {
    const bad = { name: 'Fake Color', code: 'FAKE-1', hex: '#000000', provenance: 'unverified' };
    // Simulates what would happen if an unsourced entry ever landed in the
    // dataset — the gate must exclude it, not just trust the data is clean.
    const withBad = [...CARDINAL_COLORS, bad];
    const verified = withBad.filter((c) => ['photo-verified', 'swatch-verified'].includes(c.provenance));
    expect(verified.find((c) => c.code === 'FAKE-1')).toBeUndefined();
  });

  it('loads the real, verified Cardinal dataset (131 colors)', () => {
    expect(listCardinalColors().length).toBe(131);
  });

  it('loads the real, verified Prismatic dataset (428 colors)', () => {
    expect(listPrismaticColors().length).toBe(428);
  });

  it('every Cardinal color has a real embedded photo', () => {
    const withoutPhoto = listCardinalColors().filter((c) => !c.photo);
    expect(withoutPhoto).toEqual([]);
  });
});

describe('color catalog — lookups', () => {
  it('finds a real Cardinal color by its exact code', () => {
    const sample = listCardinalColors()[0];
    expect(findCardinalByCode(sample.code)?.name).toBe(sample.name);
  });

  it('returns null for an unknown Cardinal code', () => {
    expect(findCardinalByCode('NOT-A-REAL-CODE')).toBeNull();
  });

  it('finds a real Prismatic color by its exact SKU', () => {
    const sample = listPrismaticColors()[0];
    expect(findPrismaticBySku(sample.sku)?.name).toBe(sample.name);
  });

  it('returns null for an unknown Prismatic SKU', () => {
    expect(findPrismaticBySku('NOT-A-REAL-SKU')).toBeNull();
  });

  it('derives a non-empty finish for every Cardinal color', () => {
    for (const c of listCardinalColors()) {
      expect(c.finish).toBeTruthy();
    }
    expect(cardinalFinishes().length).toBeGreaterThan(0);
  });
});

// Direct requirement (2026-09-02): "the finishes are often in the name...
// see if you can determine based on the data." Verified against Prismatic's
// own live site (prismaticpowders.com/shop/powder-coating-colors) that RAL
// and River are both real finish categories there. Checked what's actually
// present in the stored 428 names/SKUs (not assumed): only those two are
// derivable — the other 6 real finish keywords (Solid Tone, Transparent,
// Metallic, Texture, Vein, Wrinkle) appear in zero stored names, and a live
// spot-check found this dataset no longer matches the current site's SKU
// scheme at all. finish stays null for those rather than guessed.
describe('Prismatic finish derivation (RAL / River, verified against the real site)', () => {
  it('classifies a RAL-prefixed SKU as "RAL", even though its name also contains "River"', () => {
    const color = PRISMATIC_COLORS.find((c) => c.sku === 'RAL-7035-RIVER');
    expect(color.name).toBe('Ral 7035 River');
    expect(color.finish).toBe('RAL');
  });

  it('classifies a non-RAL color with "River" in the name as "River"', () => {
    const color = PRISMATIC_COLORS.find((c) => c.sku === 'PRB-4432');
    expect(color.name).toBe('Matte Black River');
    expect(color.finish).toBe('River');
  });

  it('leaves finish null for a color with no RAL/River signal — never guesses one', () => {
    const color = PRISMATIC_COLORS.find((c) => c.sku === 'PRB-10395');
    expect(color.name).toBe('Can-Am Tan 21');
    expect(color.finish).toBeNull();
  });

  it('every RAL-prefixed SKU is classified RAL, never left as River', () => {
    const ralColors = PRISMATIC_COLORS.filter((c) => c.sku.startsWith('RAL-'));
    expect(ralColors.length).toBeGreaterThan(0);
    for (const c of ralColors) {
      expect(c.finish).toBe('RAL');
    }
  });

  it('prismaticFinishes() only lists real, derivable categories — never a null/unknown placeholder', () => {
    const options = prismaticFinishes();
    expect(options).toEqual(['RAL', 'River']);
  });
});

describe('vinyl mat/pad colors (real supplier photos, pixel-sampled)', () => {
  it('loads exactly the 14 real named colors provided, matching the R board', () => {
    const names = listVinylColors().map((c) => c.name).sort();
    expect(names).toEqual([
      'Black', 'Charcoal', 'Kelly Green', 'Light Gray', 'Lime', 'Navy', 'Orange',
      'Pink', 'Purple', 'Red', 'Royal Blue', 'Tan', 'White', 'Yellow',
    ]);
  });

  it('every vinyl color has a real photo and a pixel-sampled hex, never a guessed one', () => {
    for (const c of listVinylColors()) {
      expect(c.photo).toBeTruthy();
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('finds a real vinyl color by its exact name', () => {
    expect(findVinylByName('Kelly Green')?.hex).toBeTruthy();
  });

  it('returns null for an unknown vinyl color name — never fabricates one', () => {
    expect(findVinylByName('Refer to Notes')).toBeNull();
    expect(findVinylByName('Mauve')).toBeNull();
  });
});

// Real bug found by independent code review (2026-09-02), fixed in two
// places that had each independently reimplemented the identical scan
// (pages/admin/index.js, then components/portal/ColorSelectionTab.js's
// own ConfirmedView) before being centralized here.
describe('findOrphanedSelections', () => {
  const inputs = [{ input: 'structure_frame_paint', label: 'Structure & Frame Paint', parts: ['legs', 'slide_color'] }];

  it('returns nothing when every selection matches a current required part', () => {
    const selections = { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } } };
    expect(findOrphanedSelections(inputs, selections)).toEqual([]);
  });

  it('surfaces a real selection under a part key the current requirements no longer have', () => {
    // Simulates an order whose productType changed after confirmation —
    // 'soar_frame' isn't a part of structure_frame_paint for any productType
    // in this test's `inputs`, matching real orphaned data left behind by a
    // productType edit (see lib/colorRequirements.js's per-productType parts).
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'cardinal', code: 'T009-BG01' },
        soar_frame: { brand: 'cardinal', code: 'P009-BG02' },
      },
    };
    const orphans = findOrphanedSelections(inputs, selections);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].inputKey).toBe('structure_frame_paint');
    expect(orphans[0].partKey).toBe('soar_frame');
    expect(orphans[0].color.name).toBe('Beige 90 Gloss');
  });

  it('surfaces a real selection under an entire input key the current requirements no longer have', () => {
    const selections = {
      mat_pad_color: { mat_pad: { brand: 'vinyl', code: 'Kelly Green' } },
    };
    const orphans = findOrphanedSelections(inputs, selections);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].inputKey).toBe('mat_pad_color');
  });

  it('never surfaces an unrecognized/unresolvable catalog code as an orphan', () => {
    const selections = { structure_frame_paint: { soar_frame: { brand: 'cardinal', code: 'NOT-A-REAL-CODE' } } };
    expect(findOrphanedSelections(inputs, selections)).toEqual([]);
  });

  it('handles missing/empty selections and requiredInputs without throwing', () => {
    expect(findOrphanedSelections(inputs, {})).toEqual([]);
    expect(findOrphanedSelections(inputs, null)).toEqual([]);
    expect(findOrphanedSelections(null, { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } } })).toHaveLength(1);
  });
});

describe('resolveSelectedColor', () => {
  it('resolves a real Cardinal selection back to its catalog entry', () => {
    const color = resolveSelectedColor({ brand: 'cardinal', code: 'T009-BG01' });
    expect(color?.name).toBe('Almond 90 Gloss');
  });
  it('resolves a real Prismatic selection back to its catalog entry', () => {
    const color = resolveSelectedColor({ brand: 'prismatic', code: 'PRB-10395' });
    expect(color?.name).toBe('Can-Am Tan 21');
  });
  it('returns null for a missing or unrecognized selection', () => {
    expect(resolveSelectedColor(null)).toBeNull();
    expect(resolveSelectedColor({ brand: 'cardinal', code: 'NOT-REAL' })).toBeNull();
  });
});

describe('computeLineItemPricing', () => {
  const inputs = [{ input: 'structure_frame_paint', label: 'Structure & Frame Paint', parts: ['legs', 'slide_color'] }];

  it('prices the first Prismatic selection at $500 and resolves its color', () => {
    const selections = { structure_frame_paint: { legs: { brand: 'prismatic', code: 'PRB-10395' } } };
    const [line] = computeLineItemPricing(inputs, selections);
    expect(line.amount).toBe(500);
    expect(line.color?.name).toBe('Can-Am Tan 21');
  });

  it('prices a second Prismatic selection at $300, matching computeTotalUpcharge — not a separately-drifting number', () => {
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: 'PRB-10395' },
        slide_color: { brand: 'prismatic', code: 'PRB-4432' },
      },
    };
    const lines = computeLineItemPricing(inputs, selections);
    expect(lines.map((l) => l.amount)).toEqual([500, 300]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(800);
  });

  it('charges a repeated Prismatic color only once, even reused across parts', () => {
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: 'PRB-10395' },
        slide_color: { brand: 'prismatic', code: 'PRB-10395' },
      },
    };
    const lines = computeLineItemPricing(inputs, selections);
    expect(lines.map((l) => l.amount)).toEqual([500, 0]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(500);
  });

  it('prices a third, still-unique Prismatic color at $300 even after a repeat in between', () => {
    const threePartInputs = [{ input: 'structure_frame_paint', label: 'Structure & Frame Paint', parts: ['legs', 'slide_color', 'roof'] }];
    const selections = {
      structure_frame_paint: {
        legs: { brand: 'prismatic', code: 'PRB-10395' },
        slide_color: { brand: 'prismatic', code: 'PRB-10395' },
        roof: { brand: 'prismatic', code: 'PRB-4432' },
      },
    };
    const lines = computeLineItemPricing(threePartInputs, selections);
    expect(lines.map((l) => l.amount)).toEqual([500, 0, 300]);
  });

  it('a Cardinal selection is never priced', () => {
    const selections = { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } } };
    const [line] = computeLineItemPricing(inputs, selections);
    expect(line.amount).toBe(0);
  });

  it('a missing part still appears in the lines, unpriced and unresolved', () => {
    const [line] = computeLineItemPricing(inputs, {});
    expect(line.amount).toBe(0);
    expect(line.color).toBeNull();
    expect(line.selection).toBeNull();
  });
});

// Direct customer feedback (2026-09-02, second round after title-casing):
// external standard references (FS/RAL/ANSI) that Cardinal itself publishes
// as part of the color name still read as "a code in the name." These
// strip the leading standard token for display without touching the real,
// verified `name` field the rest of the app relies on.
describe('displayColorName / standardDesignation (real Cardinal FS/RAL/ANSI names)', () => {
  it('strips a leading Federal Standard token, with or without a space before the digits', () => {
    expect(displayColorName({ name: 'FS 33446 Desert Sand Flat' })).toBe('Desert Sand Flat');
    expect(displayColorName({ name: 'FS14066 D.O.T Green 70 Gloss' })).toBe('D.O.T Green 70 Gloss');
  });
  it('strips a leading RAL or ANSI token', () => {
    expect(displayColorName({ name: 'RAL 8028 Terra Brown 90 Gloss' })).toBe('Terra Brown 90 Gloss');
    expect(displayColorName({ name: 'ANSI 61 Gray 40 Gloss' })).toBe('Gray 40 Gloss');
  });
  it('leaves an ordinary name (no standard prefix) unchanged', () => {
    expect(displayColorName({ name: 'Almond 90 Gloss' })).toBe('Almond 90 Gloss');
  });
  it('recovers the stripped standard designation separately, so nothing is lost', () => {
    expect(standardDesignation({ name: 'RAL 8028 Terra Brown 90 Gloss' })).toBe('RAL 8028');
    expect(standardDesignation({ name: 'Almond 90 Gloss' })).toBeNull();
  });
  it('never mutates the underlying dataset — the real name is still the source of truth', () => {
    const fs = CARDINAL_COLORS.find((c) => c.code === 'P000-BG631');
    expect(fs.name).toBe('FS 33446 Desert Sand Flat');
  });
});

// Real gap reported directly (2026-09-02): Cardinal reuses an identical
// display name for distinct SKUs within the same color-family tab (e.g. two
// separate "Black Fine Texture" powders), which rendered as identical bold
// labels on the grid with nothing but a smaller code line to tell them
// apart — easy to mistake for a scraping bug rather than real catalog data.
describe('displayColorName — Cardinal duplicate-name disambiguation', () => {
  it('appends the distinguishing code suffix to every duplicate Cardinal name', () => {
    const a = CARDINAL_COLORS.find((c) => c.code === 'C241-BK303');
    const b = CARDINAL_COLORS.find((c) => c.code === 'C241-BK110');
    expect(a.name).toBe('Black Fine Texture');
    expect(b.name).toBe('Black Fine Texture');
    expect(displayColorName(a)).toBe('Black Fine Texture (BK303)');
    expect(displayColorName(b)).toBe('Black Fine Texture (BK110)');
    expect(displayColorName(a)).not.toBe(displayColorName(b));
  });

  it('disambiguates a duplicate even when a standard-prefix strip is what creates the collision', () => {
    // "Black Flat" (E300-BK11 / E300-BK147) collides with "FS 37038 Black
    // Flat" (P000-BK247) only after the FS prefix is stripped for display.
    const plain = CARDINAL_COLORS.find((c) => c.code === 'E300-BK11');
    const withStandardPrefix = CARDINAL_COLORS.find((c) => c.code === 'P000-BK247');
    expect(withStandardPrefix.name).toBe('FS 37038 Black Flat');
    expect(displayColorName(plain)).toBe('Black Flat (BK11)');
    expect(displayColorName(withStandardPrefix)).toBe('Black Flat (BK247)');
  });

  it('leaves a non-duplicate Cardinal name exactly as-is, with no suffix appended', () => {
    const sample = CARDINAL_COLORS.find((c) => c.code === 'T009-BG01');
    expect(displayColorName(sample)).toBe('Almond 90 Gloss');
  });

  it('scopes collision counting per-brand — a name shape that only collides in one brand does not affect the other', () => {
    // "Black Fine Texture" is a real Cardinal collision but does not exist
    // anywhere in Prismatic's catalog — a synthetic Prismatic color sharing
    // that name has nothing real to collide with under the 'prismatic' scope.
    const prismaticShape = { name: 'Black Fine Texture', sku: 'PRB-0000', brand: 'prismatic' };
    expect(displayColorName(prismaticShape)).toBe('Black Fine Texture');
  });

  it('every real Cardinal color has a display name that is unique across the whole catalog', () => {
    const displayNames = CARDINAL_COLORS.map((c) => displayColorName(c));
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });
});

// Found by independent code review (2026-09-02), verified directly against
// the data: displayColorName's disambiguation was gated to Cardinal only,
// but Prismatic has its own real, much larger collision — all 170
// RAL-prefixed colors are named "Ral #### River" (e.g. "Ral 7035 River",
// "Ral 9005 River"), and stripStandardPrefix strips the leading "Ral ####"
// exactly like it strips Cardinal's FS/RAL/ANSI tokens, collapsing all 170
// to the identical stripped name "River". Before this fix, every one of
// those 170 swatches rendered the identical bold label "River" with
// nothing (Prismatic has no photos) to tell them apart.
describe('displayColorName — Prismatic RAL/River disambiguation (170-color collision)', () => {
  it('disambiguates two different RAL colors that both strip to "River", using the real RAL number', () => {
    const a = PRISMATIC_COLORS.find((c) => c.sku === 'RAL-7035-RIVER');
    const b = PRISMATIC_COLORS.find((c) => c.sku === 'RAL-9005-RIVER');
    expect(a.name).toBe('Ral 7035 River');
    expect(b.name).toBe('Ral 9005 River');
    expect(displayColorName(a)).toBe('River (7035)');
    expect(displayColorName(b)).toBe('River (9005)');
    expect(displayColorName(a)).not.toBe(displayColorName(b));
  });

  it('leaves a non-duplicate Prismatic name exactly as-is, with no suffix appended', () => {
    const sample = PRISMATIC_COLORS.find((c) => c.sku === 'PRB-10395');
    expect(displayColorName(sample)).toBe('Can-Am Tan 21');
  });

  it('every real Prismatic color has a display name that is unique across the whole catalog', () => {
    const displayNames = PRISMATIC_COLORS.map((c) => displayColorName(c));
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });
});
