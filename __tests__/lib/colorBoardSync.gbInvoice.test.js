import { describe, it, expect, vi, afterEach } from 'vitest';
import { readGbPrismaticInvoice } from '../../lib/colorBoardSync';

// Audit follow-up 2026-10-18: the confirm compares GB's own Prismatic invoice
// formula with what the customer was shown. These are the real display
// formats read from the live GB board.
function stubFormula(displayValue) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { items: [{ column_values: [{ display_value: displayValue }] }] } }),
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('readGbPrismaticInvoice', () => {
  it.each([
    ['💰 ADD TO INVOICE: $500.00', 500],
    ['💰 ADD TO INVOICE: $1,100.00', 1100],
    ['$0.00', 0],
  ])('parses %s', async (display, expected) => {
    stubFormula(display);
    expect(await readGbPrismaticInvoice('1')).toBe(expected);
  });

  it('returns null when the value is blank or unreadable', async () => {
    stubFormula('');
    expect(await readGbPrismaticInvoice('1')).toBeNull();
    stubFormula(null);
    expect(await readGbPrismaticInvoice('1')).toBeNull();
  });
});
