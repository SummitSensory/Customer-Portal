import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveDeliveryContacts,
  sendCustomerNotificationOnce,
  incrementUgcCounts,
  updateFreightNotifyTag,
  findOrderByFreightTracking,
  getAllOrders,
  getOrderByEmail,
  UGC_COLS,
} from './monday';

// lib/monday.js has no broader test coverage (its real functions are almost
// entirely Monday API I/O, expensive to mock meaningfully) — this file is
// scoped to resolveDeliveryContacts specifically: a pure function added
// 2026-09-03 so AfterShip can be told a real delivery contact instead of
// just an order title (see lib/aftership.js's `contacts` param and its two
// callers, pages/api/aftership/track.js and
// pages/api/cron/accessory-tracking-sync.js).
//
// The describe blocks below (added as part of the 2026-09-21 race-condition
// audit) are the exception: sendCustomerNotificationOnce, incrementUgcCounts
// and updateFreightNotifyTag/findOrderByFreightTracking all fix real
// concurrency bugs that a mocked global.fetch CAN exercise meaningfully —
// each test drives the exact sequence of Monday API calls the fixed
// function makes and asserts on the specific race behavior the fix closes,
// rather than trying to cover this file's I/O broadly.

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('./monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
}

describe('resolveDeliveryContacts', () => {
  it('prefers the customer\'s own most-recent Delivery tab submission over the CRM mirror columns', () => {
    const order = {
      freightNotifyEnabled: true,
      pocName: 'Old CRM Name', pocEmail: 'old@crm.example.com', phone: '555-000-0000',
      deliverySnapshot: { pocName: 'Jane Customer', pocEmail: 'jane@real.example.com', pocPhone: '555-111-2222' },
    };
    const { primary, secondary } = resolveDeliveryContacts(order);
    expect(primary).toEqual({ name: 'Jane Customer', email: 'jane@real.example.com', phone: '555-111-2222' });
    expect(secondary).toBeNull();
  });

  it('falls back to the CRM mirror columns when no Delivery tab submission exists yet', () => {
    const order = { freightNotifyEnabled: true, pocName: 'CRM Name', pocEmail: 'crm@example.com', phone: '555-000-0000', deliverySnapshot: null };
    const { primary } = resolveDeliveryContacts(order);
    expect(primary).toEqual({ name: 'CRM Name', email: 'crm@example.com', phone: '555-000-0000' });
  });

  it('returns primary: null when there is no contact data anywhere — never fabricates one', () => {
    const { primary } = resolveDeliveryContacts({ freightNotifyEnabled: true, deliverySnapshot: null });
    expect(primary).toBeNull();
  });

  it('returns primary: null for a null/undefined order', () => {
    expect(resolveDeliveryContacts(null).primary).toBeNull();
    expect(resolveDeliveryContacts(undefined).primary).toBeNull();
  });

  it('only returns a secondary contact when the customer explicitly turned one on', () => {
    const order = {
      freightNotifyEnabled: true,
      deliverySnapshot: {
        pocName: 'Jane', pocEmail: 'jane@example.com', pocPhone: '555-1111',
        hasSecondaryPoc: false,
        secondaryPocName: 'Leftover Name From A Previous Toggle', secondaryPocEmail: 'stale@example.com',
      },
    };
    const { secondary } = resolveDeliveryContacts(order);
    expect(secondary).toBeNull();
  });

  it('returns a secondary contact when hasSecondaryPoc is true and it has real data', () => {
    const order = {
      freightNotifyEnabled: true,
      deliverySnapshot: {
        pocName: 'Jane', pocEmail: 'jane@example.com', pocPhone: '555-1111',
        hasSecondaryPoc: true,
        secondaryPocName: 'John Secondary', secondaryPocEmail: 'john@example.com', secondaryPocPhone: '555-2222',
      },
    };
    const { secondary } = resolveDeliveryContacts(order);
    expect(secondary).toEqual({ name: 'John Secondary', email: 'john@example.com', phone: '555-2222' });
  });

  it('does not return an empty secondary object when hasSecondaryPoc is true but no fields were actually filled in', () => {
    const order = { freightNotifyEnabled: true, deliverySnapshot: { pocEmail: 'jane@example.com', hasSecondaryPoc: true } };
    const { secondary } = resolveDeliveryContacts(order);
    expect(secondary).toBeNull();
  });

  // Fixed 2026-09-03 after an independent post-launch review: AfterShip's
  // own native notification flows have no concept of the portal's "Freight
  // Email Alerts" checkbox — they'll email anyone registered as a customer
  // on a tracking regardless of it. The only real lever is to never hand
  // AfterShip a real contact for someone who opted out.
  describe('gated on freightNotifyEnabled ("Freight Email Alerts")', () => {
    it('returns primary: null and secondary: null when the customer has not opted in, even with real contact data on file', () => {
      const order = {
        freightNotifyEnabled: false,
        deliverySnapshot: {
          pocName: 'Jane Customer', pocEmail: 'jane@example.com', pocPhone: '555-111-2222',
          hasSecondaryPoc: true,
          secondaryPocName: 'John Secondary', secondaryPocEmail: 'john@example.com', secondaryPocPhone: '555-2222',
        },
      };
      expect(resolveDeliveryContacts(order)).toEqual({ primary: null, secondary: null });
    });

    it('defaults to opted-out (matches the existing checkbox default) when freightNotifyEnabled is missing entirely', () => {
      const order = {
        deliverySnapshot: { pocName: 'Jane Customer', pocEmail: 'jane@example.com', pocPhone: '555-111-2222' },
      };
      expect(resolveDeliveryContacts(order)).toEqual({ primary: null, secondary: null });
    });
  });
});

describe('sendCustomerNotificationOnce (PORTAL-059)', () => {
  beforeEach(() => {
    mockReportCriticalFailure.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends and marks when nothing has notified for this value yet, with no race flagged', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] })) // initial hasNotifiedValue check
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] })) // re-check immediately before acting
      .mockResolvedValueOnce(jsonResponse({ create_update: { id: 1, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:00.000Z' } })) // markNotifiedValue's create_update
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [{ id: 1, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:00.000Z' }] }] })); // post-write verification

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: true, alreadyNotified: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });

  // The actual bug: orders.js's PATCH handler and status-balance-webhook.js
  // both react to the same Monday column write and used to each do their
  // own single hasNotifiedValue() check before sending — two such checks
  // landing before either one's markNotifiedValue() write completed would
  // BOTH see "not notified" and both send. This proves the re-check
  // immediately before acting (not just once at the top) catches a marker
  // that appeared in between, and skips sending entirely.
  it('skips sending when a marker appears between the initial check and the immediate re-check', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] })) // initial check: not notified yet
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [{ id: 1, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:00.000Z' }] }] })); // re-check: a concurrent caller already marked it

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', sendFn);

    expect(sendFn).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false, alreadyNotified: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a critical failure when the post-write read-back shows more than one marker — a duplicate send really happened', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockResolvedValueOnce(jsonResponse({ create_update: { id: 2, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:01.000Z' } }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          updates: [
            { id: 1, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:00.000Z' },
            { id: 2, body: '[PORTAL: Status Notified - Shipped]\nfoo', created_at: '2026-09-21T00:00:01.000Z' },
          ],
        }],
      }));

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', sendFn);

    // The write already happened from this call's own point of view — still
    // reports success, same "can't undo it, but staff must know" philosophy
    // color-selection.js's own confirm-race detection uses.
    expect(result.sent).toBe(true);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'sendCustomerNotificationOnce-race',
      expect.stringContaining('item-1'),
      expect.objectContaining({ itemId: 'item-1', kind: 'Status', value: 'Shipped', markerCount: 2 })
    );
  });
});

describe('incrementUgcCounts (PORTAL-061)', () => {
  beforeEach(() => {
    mockReportCriticalFailure.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function columnValuesResponse(photoCount, videoCount) {
    return jsonResponse({
      items: [{
        column_values: [
          { id: UGC_COLS.photoCount, text: String(photoCount), value: null },
          { id: UGC_COLS.videoCount, text: String(videoCount), value: null },
        ],
      }],
    });
  }

  // The actual bug: the old code read the counters ONCE, computed the new
  // totals off that single read, then wrote — a concurrent Showcase webhook
  // delivery for the same order that wrote in between was silently
  // overwritten (lost update). This proves the re-read-immediately-before-
  // write both (a) bases the write on the FRESHEST count, not the stale
  // initial one, and (b) flags the disagreement via reportCriticalFailure
  // instead of trusting arithmetic done on data that's already known stale.
  it('computes off the freshest re-read, not the stale initial read, and reports the race', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(columnValuesResponse(2, 0)) // initial read
      .mockResolvedValueOnce(columnValuesResponse(5, 0)) // re-read: a concurrent webhook already wrote 3 more photos
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } })) // photoCount write
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } })) // videoCount write
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } })); // rewardCredits write

    const result = await incrementUgcCounts('item-1', 0, 0);

    // Had this been computed off the stale initial read (2), photoCount
    // would be 2 here instead of 5 — the exact lost-update this fix closes.
    expect(result.photoCount).toBe(5);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'incrementUgcCounts-race',
      expect.stringContaining('item-1'),
      expect.objectContaining({
        itemId: 'item-1',
        initialRead: { photoCount: 2, videoCount: 0 },
        freshRead: { photoCount: 5, videoCount: 0 },
      })
    );
  });

  it('does not report a race when the two reads agree', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(columnValuesResponse(2, 0))
      .mockResolvedValueOnce(columnValuesResponse(2, 0))
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } }))
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } }))
      .mockResolvedValueOnce(jsonResponse({ change_column_value: { id: 'x' } }));

    const result = await incrementUgcCounts('item-1', 1, 0);

    expect(result.photoCount).toBe(3);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });
});

describe('updateFreightNotifyTag invalidates the getAllOrders() board cache (PORTAL-060)', () => {
  const FRAME_SLUG_COL = 'text_mm538vtm';
  const FRAME_TRACKING_COL = 'text_mm53p3b2';
  const FRAME_NOTIFY_TAG_COL = 'text_mm5b9ey6';

  function orderItem(notifyTag) {
    return {
      id: '111',
      name: 'Order 111',
      created_at: '2026-01-01T00:00:00.000Z',
      column_values: [
        { id: FRAME_SLUG_COL, text: 'fedex', value: null },
        { id: FRAME_TRACKING_COL, text: 'TRACK123', value: null },
        { id: FRAME_NOTIFY_TAG_COL, text: notifyTag, value: null },
      ],
      subitems: [],
    };
  }

  function boardsPageResponse(item) {
    return jsonResponse({ boards: [{ items_page: { cursor: null, items: [item] } }] });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The actual bug: findOrderByFreightTracking() (the AfterShip webhook's
  // dedupe check) reads lastNotifiedTag out of getAllOrders()'s 20-second
  // in-memory cache. Without invalidating that cache the moment
  // updateFreightNotifyTag() writes, a repeated AfterShip checkpoint webhook
  // arriving within that same 20s window would still read the OLD tag and
  // re-send the customer email. This drives the exact sequence: read
  // (caches) -> read again (still cached, same old tag) -> write (must
  // invalidate) -> read again (must be a fresh call, must see the new tag).
  it('makes the very next dedupe read see the new tag instead of the still-live 20s cache', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(boardsPageResponse(orderItem('OldTag')));
    const before = await findOrderByFreightTracking('fedex', 'TRACK123');
    expect(before.lastNotifiedTag).toBe('OldTag');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still within the 20s TTL — sharing the cached board read here is the
    // deliberate, documented caching behavior, not the bug.
    const stillCached = await findOrderByFreightTracking('fedex', 'TRACK123');
    expect(stillCached.lastNotifiedTag).toBe('OldTag');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ change_simple_column_value: { id: '111' } }));
    await updateFreightNotifyTag('111', 'frame', 'NewTag');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Without the cache-invalidation fix, this would still return the
    // stale 'OldTag' from the not-yet-expired cache instead of a fresh call.
    fetchMock.mockResolvedValueOnce(boardsPageResponse(orderItem('NewTag')));
    const after = await findOrderByFreightTracking('fedex', 'TRACK123');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(after.lastNotifiedTag).toBe('NewTag');
  });
});

// PORTAL-060 follow-up: pages/api/auth/send-code.js's order-existence check
// (gates whether a real login-code email is sent at all) previously always
// read through the 20s board cache, so a brand-new order could be
// misclassified as "no order" and silently skip the real send. `{ fresh:
// true }` bypasses the cache entirely — proven here by two consecutive
// calls each triggering their own fetch, unlike the cached default path
// (covered by the describe block above, which proves a second call within
// the TTL reuses the cache).
describe('getAllOrders / getOrderByEmail — `{ fresh: true }` bypasses the board cache (PORTAL-060)', () => {
  const EMAIL_COL = 'email__1';

  function emailOrderItem(id, email) {
    return {
      id,
      name: `Order ${id}`,
      created_at: '2026-01-01T00:00:00.000Z',
      column_values: [{ id: EMAIL_COL, text: email, value: null }],
      subitems: [],
    };
  }

  function boardsPageResponse(items) {
    return jsonResponse({ boards: [{ items_page: { cursor: null, items } }] });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getAllOrders({ fresh: true }) issues a brand-new fetch every call, never serving the cache', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(boardsPageResponse([emailOrderItem('1', 'a@b.com')]));
    await getAllOrders({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second `fresh: true` call immediately after must still hit the
    // network again — proof it never consults (or populates) the cache
    // the default path relies on.
    fetchMock.mockResolvedValueOnce(boardsPageResponse([emailOrderItem('1', 'a@b.com')]));
    await getAllOrders({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getOrderByEmail(email, { fresh: true }) finds an order that only just started existing, never masked by a stale prior "no order" cache entry', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // A brand-new order for this email now exists on Monday.
    fetchMock.mockResolvedValueOnce(boardsPageResponse([emailOrderItem('42', 'new-customer@example.com')]));
    const order = await getOrderByEmail('new-customer@example.com', { fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(order?.id).toBe('42');
  });
});
