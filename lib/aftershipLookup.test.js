import { describe, it, expect, vi, afterEach } from 'vitest';
import { findOrderByFreightTracking, findAccessorySubitemByTracking, COLS, ACCESSORY_COLS } from './monday';

// Audit 2026-10-09: the AfterShip webhook read the whole Manufacturing board
// (and the whole accessory board) for every checkpoint. These lookups now ask
// Monday for the rows carrying the tracking number, and only fall back to a
// full scan when that query fails.

vi.mock('./monitoring', () => ({ reportCriticalFailure: vi.fn() }));

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }), text: async () => '' });

function orderItem({ id, frame = '', frameSlug = '', mats = '', matsSlug = '', tag = '' }) {
  return {
    id, name: `Order ${id}`, created_at: '2026-10-01T00:00:00Z',
    column_values: [
      { id: COLS.frameTrackingId, text: frame, value: null },
      { id: COLS.frameCarrierSlug, text: frameSlug, value: null },
      { id: COLS.matsTrackingId, text: mats, value: null },
      { id: COLS.matsCarrierSlug, text: matsSlug, value: null },
      { id: COLS.frameNotifyTag, text: tag, value: null },
      { id: COLS.customerEmail, text: 'c@school.org', value: null },
    ],
    mirror_values: [], assets: [], subitems: [],
  };
}

const bodyOf = (call) => JSON.parse(call[1].body);

afterEach(() => vi.unstubAllGlobals());

describe('findOrderByFreightTracking', () => {
  it('finds the order with a targeted column query, never a full board read', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes('items_page_by_column_values')) {
        return ok({ items_page_by_column_values: { items: variables.col === COLS.frameTrackingId ? [{ id: '42' }] : [] } });
      }
      if (query.includes('items(ids')) {
        return ok({ items: [orderItem({ id: '42', frame: 'PRO123', frameSlug: 'estes', tag: 'In Transit' })] });
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await findOrderByFreightTracking('estes', 'PRO123');
    expect(result).toMatchObject({ itemId: '42', shipmentKey: 'frame', lastNotifiedTag: 'In Transit' });
    expect(fetchMock.mock.calls.some(c => bodyOf(c).query.includes('items_page(') || bodyOf(c).query.includes('boards('))).toBe(false);
  });

  it('returns null without a full scan when the number is on no order', async () => {
    const fetchMock = vi.fn(async () => ok({ items_page_by_column_values: { items: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await findOrderByFreightTracking('estes', 'NOPE')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // frame + mats column queries only
  });

  it('respects the carrier slug', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { query } = JSON.parse(init.body);
      if (query.includes('items_page_by_column_values')) return ok({ items_page_by_column_values: { items: [{ id: '42' }] } });
      return ok({ items: [orderItem({ id: '42', mats: 'PRO9', matsSlug: 'ups' })] });
    }));
    expect(await findOrderByFreightTracking('fedex', 'PRO9')).toBeNull();
    expect(await findOrderByFreightTracking('ups', 'PRO9')).toMatchObject({ shipmentKey: 'mats' });
  });
});

describe('findAccessorySubitemByTracking', () => {
  it('uses a targeted query on the accessory tracking column', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      expect(query).toContain('items_page_by_column_values');
      expect(variables.col).toBe(ACCESSORY_COLS.trackingNumber);
      return ok({ items_page_by_column_values: { items: [{
        id: 's1', name: 'Ball Pit', parent_item: { id: '42' },
        column_values: [
          { id: ACCESSORY_COLS.trackingNumber, text: 'TRK1', value: null },
          { id: ACCESSORY_COLS.carrier, text: 'fedex', value: null },
        ],
      }] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await findAccessorySubitemByTracking('fedex', 'TRK1')).toEqual({ id: 's1', name: 'Ball Pit' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
