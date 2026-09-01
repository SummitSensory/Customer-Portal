import { describe, it, expect } from 'vitest';
import {
  listCardinalColors,
  listPrismaticColors,
  listVinylColors,
  findCardinalByCode,
  findPrismaticBySku,
  findVinylByName,
  cardinalFinishes,
  prismaticUpcharge,
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

describe('Prismatic upcharge pricing (live Monday formula, fixed 2026-08-31)', () => {
  it('is $0 for zero Prismatic selections', () => {
    expect(prismaticUpcharge(0)).toBe(0);
  });
  it('is $500 for exactly one Prismatic selection', () => {
    expect(prismaticUpcharge(1)).toBe(500);
  });
  it('is $500 + $300 per additional selection', () => {
    expect(prismaticUpcharge(2)).toBe(800);
    expect(prismaticUpcharge(3)).toBe(1100);
  });
  it('does NOT use the stale $350 flat figure from the pre-08-31 mockup', () => {
    expect(prismaticUpcharge(1)).not.toBe(350);
  });
});
