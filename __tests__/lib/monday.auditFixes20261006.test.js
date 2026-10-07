import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// AUDIT-2026-10-06 — lib/monday.js pieces added/changed by that audit:
// orderMatchesEmail (shared ownership rule), toCustomerOrder /
// toCustomerMessages (customer-facing serializers), the Portal-Files-only
// getOrderFiles filter, sendCustomerNotificationOnce's marker-failure path,
// and mondayRetryWaitMs (honouring Monday's retry_in_seconds).

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const {
  orderMatchesEmail,
  toCustomerOrder,
  toCustomerMessages,
  portalFileAssetIds,
  getOrderFiles,
  getOrdersByEmail,
  sendCustomerNotificationOnce,
  mondayRetryWaitMs,
  COLS,
} = await import('../../lib/monday');
const { isStaffMessage, isStaffReply, isPortalChatMessage } = await import('../../lib/messageOrigin');

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
}

describe('orderMatchesEmail', () => {
  it('matches case-insensitively with surrounding whitespace ignored on both sides', () => {
    expect(orderMatchesEmail({ customerEmail: ' Jane@School.ORG ' }, 'jane@school.org  ')).toBe(true);
  });

  it('rejects a different email', () => {
    expect(orderMatchesEmail({ customerEmail: 'jane@school.org' }, 'john@school.org')).toBe(false);
  });

  it('never matches a blank email to a blank column (or a missing order)', () => {
    expect(orderMatchesEmail({ customerEmail: '' }, '')).toBe(false);
    expect(orderMatchesEmail({}, undefined)).toBe(false);
    expect(orderMatchesEmail(null, 'a@b.com')).toBe(false);
  });

  it('is exactly the rule getOrdersByEmail filters with', async () => {
    process.env.MONDAY_BOARD_ID = 'board-1';
    const items = [
      { id: '1', name: 'Mine', created_at: '2026-01-01', column_values: [{ id: COLS.customerEmail, text: 'Jane@School.org', value: null }] },
      { id: '2', name: 'Not mine', created_at: '2026-01-02', column_values: [{ id: COLS.customerEmail, text: 'other@school.org', value: null }] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ boards: [{ items_page: { cursor: null, items } }] })));
    try {
      const orders = await getOrdersByEmail(' jane@school.org', { fresh: true });
      expect(orders.map((o) => o.id)).toEqual(['1']);
      for (const o of orders) expect(orderMatchesEmail(o, ' jane@school.org')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('toCustomerOrder', () => {
  it('drops rawColumns and files and keeps everything the portal reads', () => {
    const order = {
      id: '1', name: 'Order', customerEmail: 'a@b.com', progress: { billing: '✅' },
      colorSelectionSnapshot: null, accessoryItems: [], rawColumns: { x: { text: 'internal' } }, files: [{ id: 'f' }],
    };
    const out = toCustomerOrder(order);
    expect(out).not.toHaveProperty('rawColumns');
    expect(out).not.toHaveProperty('files');
    expect(out).toEqual({ id: '1', name: 'Order', customerEmail: 'a@b.com', progress: { billing: '✅' }, colorSelectionSnapshot: null, accessoryItems: [] });
    // Does not mutate the input (it may be a cached board row).
    expect(order.rawColumns).toBeDefined();
  });

  it('passes null/undefined through', () => {
    expect(toCustomerOrder(null)).toBeNull();
    expect(toCustomerOrder(undefined)).toBeUndefined();
  });
});

describe('toCustomerMessages', () => {
  const bryan = { id: 9, name: 'Bryan Shepherd', email: 'bryan@summitsensory.com' };
  const updates = [
    { id: 1, body: '[PORTAL][PORTAL:CUSTOMER]\nHi there', created_at: 't1', creator: bryan, replies: [
      { id: 11, body: 'Staff reply in Monday', created_at: 't2', creator: { id: 3, name: 'Kyle', email: 'kyle@summitsensory.com' } },
    ] },
    { id: 2, body: '[PORTAL][PORTAL:STAFF]\nWe got it', created_at: 't3', creator: bryan, replies: [] },
    { id: 3, body: '[PORTAL: Staff Viewing As Customer]\nstaff@x started viewing', created_at: 't4', creator: bryan, replies: [] },
    { id: 4, body: 'Internal note: customer is difficult', created_at: 't5', creator: { id: 4, name: 'Kyle', email: 'kyle@summitsensory.com' }, replies: [] },
    { id: 5, body: '[PORTAL]\nlegacy untagged portal message', created_at: 't6', creator: bryan, replies: [] },
  ];

  it('keeps only what the portal renders: [PORTAL] chat messages, with all their replies', () => {
    const out = toCustomerMessages(updates);
    expect(out.map((m) => m.id)).toEqual([1, 2, 5]);
    expect(out[0].replies.map((r) => r.id)).toEqual([11]);
    // Identical to the page's own filter.
    expect(out.map((m) => m.id)).toEqual(updates.filter(isPortalChatMessage).map((m) => m.id));
  });

  it('never exposes a real creator email or name', () => {
    const json = JSON.stringify(toCustomerMessages(updates));
    expect(json).not.toContain('bryan@summitsensory.com');
    expect(json).not.toContain('kyle@summitsensory.com');
    expect(json).not.toContain('Bryan Shepherd');
  });

  it('classifies every bubble exactly as the page did with the raw data', () => {
    const out = toCustomerMessages(updates);
    const raw = updates.filter(isPortalChatMessage);
    out.forEach((m, i) => {
      expect(isStaffMessage(m)).toBe(isStaffMessage(raw[i]));
      expect(m.isStaff).toBe(isStaffMessage(raw[i]));
      m.replies.forEach((r, j) => {
        expect(isStaffReply(r)).toBe(isStaffReply(raw[i].replies[j]));
        expect(r.isStaff).toBe(isStaffReply(raw[i].replies[j]));
      });
    });
    expect(out.find((m) => m.id === 1).isStaff).toBe(false);
    expect(out.find((m) => m.id === 2).isStaff).toBe(true);
  });

  it('a customer-authored reply (non-staff creator) stays non-staff with no email', () => {
    const [m] = toCustomerMessages([{ id: 1, body: '[PORTAL][PORTAL:STAFF]\nq', created_at: 't', creator: bryan, replies: [
      { id: 2, body: 'answer', created_at: 't', creator: { id: 7, name: 'Jane', email: 'jane@school.org' } },
    ] }]);
    expect(m.replies[0].isStaff).toBe(false);
    expect(m.replies[0].creator.email).toBe('');
  });
});

describe('getOrderFiles — Portal Files column only for customers', () => {
  afterEach(() => vi.unstubAllGlobals());

  const assets = [
    { id: '100', name: 'drawing.pdf', public_url: 'u1', uploaded_by: { id: 1, name: 'Kyle' } },
    { id: '200', name: 'internal-cost-sheet.xlsx', public_url: 'u2', uploaded_by: { id: 1, name: 'Kyle' } },
    { id: '300', name: 'tax-cert.pdf', public_url: 'u3', uploaded_by: { id: 1, name: 'Kyle' } },
  ];
  function stub(columnValue) {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ column_values: [{ id: COLS.portalFiles, value: columnValue }], assets }] }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('parses asset ids out of a file column value', () => {
    expect([...portalFileAssetIds('{"files":[{"assetId":100,"name":"a"},{"assetId":"300"}]}')]).toEqual(['100', '300']);
    expect(portalFileAssetIds('not json').size).toBe(0);
    expect(portalFileAssetIds(null).size).toBe(0);
  });

  it('returns only assets referenced by the Portal Files column, without uploaded_by', async () => {
    const fetchMock = stub(JSON.stringify({ files: [{ assetId: 100, name: 'drawing.pdf', isImage: 'false' }] }));
    const files = await getOrderFiles('item-1', { portalFilesOnly: true });
    expect(files).toEqual([{ id: '100', name: 'drawing.pdf', public_url: 'u1' }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain(COLS.portalFiles);
  });

  it('fails closed — an empty/unparseable column returns no files, never all of them', async () => {
    stub(null);
    expect(await getOrderFiles('item-1', { portalFilesOnly: true })).toEqual([]);
  });

  it('staff (default) still get every asset, unchanged', async () => {
    stub(JSON.stringify({ files: [{ assetId: 100 }] }));
    expect(await getOrderFiles('item-1')).toEqual(assets);
  });
});

describe('sendCustomerNotificationOnce — marker write fails after a successful send', () => {
  beforeEach(() => mockReportCriticalFailure.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('still reports sent:true (so the webhook answers 200, no redelivery re-send) and alerts staff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockRejectedValueOnce(new Error('socket hang up')); // markNotifiedValue's create_update
    vi.stubGlobal('fetch', fetchMock);

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: true, alreadyNotified: false, markerPending: true });
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'sendCustomerNotificationOnce-marker',
      expect.stringContaining('item-1'),
      expect.objectContaining({ itemId: 'item-1', kind: 'Status', value: 'Shipped' })
    );
  });

  it('a failed SEND still throws (nothing marked, so a redelivery can retry it)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{ updates: [] }] })));
    await expect(sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', () => Promise.reject(new Error('resend down'))))
      .rejects.toThrow('resend down');
  });
});

describe('mondayRetryWaitMs', () => {
  it('uses the existing linear backoff when Monday gives no hint', () => {
    expect(mondayRetryWaitMs(0)).toBe(1500);
    expect(mondayRetryWaitMs(2, { json: { errors: [{ message: 'Complexity budget exhausted' }] } })).toBe(4500);
  });

  it('honours extensions.retry_in_seconds, never below the backoff, capped at 8s', () => {
    const json = (s) => ({ errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: s } }] });
    expect(mondayRetryWaitMs(0, { json: json(5) })).toBe(5000);
    expect(mondayRetryWaitMs(1, { json: json(1) })).toBe(3000);
    expect(mondayRetryWaitMs(0, { json: json(40) })).toBe(8000);
  });

  it('honours a Retry-After header on a plain 429', () => {
    expect(mondayRetryWaitMs(0, { retryAfterHeader: '6' })).toBe(6000);
    expect(mondayRetryWaitMs(0, { retryAfterHeader: 'garbage' })).toBe(1500);
  });
});
