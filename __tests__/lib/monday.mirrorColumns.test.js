import { describe, it, expect, vi, afterEach } from 'vitest';
import { getOrderById, COLS } from '../../lib/monday';

// Mirror (lookup) columns return text: null / value: null from Monday's API;
// their content only comes back as display_value (MirrorValue fragment).
// Before 2026-09-23 the portal never requested it, so every mirror it read
// — the color-selection gates, bill-to address on file, Delivery POC,
// primary contact — silently came back blank. And the gate IDs pointed at
// Deal Tracking's columns, which don't exist on Manufacturing Process at all.

function mondayItem(mirrors) {
  return {
    id: '12964423844', name: 'Pediatric Therapy Associates (27607)', created_at: '2026-09-01T00:00:00Z',
    column_values: [
      // Real API shape for a mirror in column_values: no usable text/value.
      ...Object.keys(mirrors).map((id) => ({ id, text: null, value: null })),
      { id: COLS.productType, text: 'Summit Adventure Series: Custom Sensory Gym', value: null },
    ],
    mirror_values: Object.entries(mirrors).map(([id, display_value]) => ({ id, display_value })),
    assets: [],
    subitems: [],
  };
}

function stubMonday(item) {
  const bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ data: { items: [item] } }) };
  }));
  return bodies;
}

describe('mirror columns', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gate columns point at the Manufacturing Process mirrors, not Deal Tracking IDs', () => {
    expect(COLS.colorFrameType).toBe('lookup_mm7c11rs');
    expect(COLS.colorClimbingWall).toBe('lookup_mm7czm49');
    expect(COLS.colorFoundationMat).toBe('lookup_mm7ccp4a');
  });

  it('requests display_value for the mirrors it reads, and uses it', async () => {
    const bodies = stubMonday(mondayItem({
      [COLS.billingAddressOnFile]: '2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States',
      [COLS.pocName]: 'Pepper Highsmith',
      [COLS.contactEmail]: 'phighsmith@pedtherapy.com',
      [COLS.colorFrameType]: 'Adventure',
      [COLS.colorFoundationMat]: 'Included',
      [COLS.colorSoarMat]: 'NOT Included',
    }));

    const order = await getOrderById('12964423844');

    expect(bodies[0].query).toContain('... on MirrorValue { display_value }');
    expect(bodies[0].query).toContain(COLS.colorFoundationMat);
    expect(order.billingAddressOnFile).toBe('2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States');
    expect(order.pocName).toBe('Pepper Highsmith');
    expect(order.colorFrameType).toBe('Adventure');
    expect(order.colorGates.foundationMat).toBe('Included');
    expect(order.colorGates.soarMat).toBe('NOT Included');
  });

  it('an order linked to two deals: any "Included" wins, agreeing values collapse', async () => {
    stubMonday(mondayItem({
      [COLS.colorPalisadesMat]: 'Required, Included',
      [COLS.colorSlide]: 'NOT Included, NOT Included',
      [COLS.colorFrameType]: 'Required, Required',
    }));
    const order = await getOrderById('12964423844');
    expect(order.colorGates.palisadesMat).toBe('Included');
    expect(order.colorGates.slideColor).toBe('NOT Included');
    expect(order.colorFrameType).toBe('Required');
  });
});

describe('mirror values from orders linked to several deals', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('collapses a repeated address and takes the first single-token value', async () => {
    stubMonday(mondayItem({
      [COLS.billingAddressOnFile]: '4301 S Federal Blvd Suite 102-103, Sheridan, CO 80110, 4301 S Federal Blvd Suite 102-103, Sheridan, CO 80110',
      [COLS.billingZipOnFile]: '80110, 80110',
      [COLS.contactName]: 'Christine  White, Kina  Koch',
      [COLS.contactEmail]: 'a@childrens.com, b@yahoo.com',
      [COLS.firstName]: 'Christeen, Christeen',
    }));
    const order = await getOrderById('12964423844');
    expect(order.billingAddressOnFile).toBe('4301 S Federal Blvd Suite 102-103, Sheridan, CO 80110');
    expect(order.contactName).toBe('Christine  White');
    expect(order.contactEmail).toBe('a@childrens.com');
    expect(order.firstName).toBe('Christeen');
  });

  it('does not request colorFormId or the GB tracking mirrors', async () => {
    const bodies = stubMonday(mondayItem({}));
    await getOrderById('12964423844');
    const mirrorPart = bodies[0].query.match(/mirror_values: column_values\(ids: (\[[^\]]*\])/)[1];
    expect(mirrorPart).not.toContain(COLS.colorFormId);
    expect(mirrorPart).not.toContain('lookup_mm1kcbb5');
  });
});
