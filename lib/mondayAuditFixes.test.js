import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendCustomerNotificationOnce,
  incrementUgcCounts,
  fetchAllBoardItems,
  FETCH_ALL_MAX_ITEMS,
  isMondayTrackedUrl,
  mondayRetryHintMs,
  UGC_COLS,
} from './monday';
import { describeSelection } from './colorCatalog';
import { withDetail } from '../components/admin/orderDetail';

// Fixes from the 2026-10-09 full-codebase audit (data layer + admin).

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('./monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
}

beforeEach(() => mockReportCriticalFailure.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('sendCustomerNotificationOnce — marker failure after a successful send', () => {
  it('never throws once the email went out; retries the marker, then alerts and reports markFailed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] })) // initial check
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] })) // re-check
      .mockRejectedValueOnce(new Error('This operation was aborted'))   // marker write
      .mockRejectedValueOnce(new Error('This operation was aborted'));  // marker retry
    vi.stubGlobal('fetch', fetchMock);

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: true, alreadyNotified: false, markFailed: true });
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'sendCustomerNotificationOnce-marker',
      expect.stringContaining('WAS emailed'),
      expect.objectContaining({ itemId: 'item-1', kind: 'Status', value: 'Shipped' })
    );
  });

  it('a marker write that succeeds on retry is a normal success', async () => {
    const marker = { id: 1, body: '[PORTAL: Status Notified - Shipped]\nx', created_at: '2026-10-09T00:00:00.000Z' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(jsonResponse({ create_update: marker }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [marker] }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', vi.fn().mockResolvedValue(undefined));
    expect(result).toEqual({ sent: true, alreadyNotified: false });
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });

  it('a failed SEND still throws and writes no marker', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ updates: [] }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendCustomerNotificationOnce('item-1', 'Status', 'Shipped', vi.fn().mockRejectedValue(new Error('Resend down'))))
      .rejects.toThrow('Resend down');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('incrementUgcCounts — write failures are no longer swallowed', () => {
  function counts(photo, video) {
    return jsonResponse({ items: [{ column_values: [
      { id: UGC_COLS.photoCount, text: String(photo), value: null },
      { id: UGC_COLS.videoCount, text: String(video), value: null },
    ] }] });
  }

  it('attempts every write, then throws listing the failed ones', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(counts(1, 0))
      .mockResolvedValueOnce(counts(1, 0))
      .mockRejectedValueOnce(new Error('Monday 502'))                          // photoCount write fails
      .mockResolvedValue(jsonResponse({ change_column_value: { id: 'x' } })); // the rest succeed
    vi.stubGlobal('fetch', fetchMock);

    const err = await incrementUgcCounts('item-1', 2, 0).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/photoCount/);
    expect(err.failed).toHaveLength(1);
    // Two reads + every write was still attempted (photo, video, and credits if configured).
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('returns the new counts when every write lands', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(counts(1, 0))
      .mockResolvedValueOnce(counts(1, 0))
      .mockResolvedValue(jsonResponse({ change_column_value: { id: 'x' } })));
    await expect(incrementUgcCounts('item-1', 2, 1)).resolves.toMatchObject({ photoCount: 3, videoCount: 1 });
  });
});

describe('fetchAllBoardItems — item-count cap', () => {
  const page = (cursor, n = 1) => jsonResponse({ boards: [{ items_page: { cursor, items: Array.from({ length: n }, (_, i) => ({ id: String(i) })) } }] });
  const nextPage = (cursor, n = 1) => jsonResponse({ next_items_page: { cursor, items: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })) } });

  it('throws instead of returning a partial list when the cursor never terminates', async () => {
    const pageSize = FETCH_ALL_MAX_ITEMS / 2; // cap = 2 pages
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(page('c1'))
      .mockResolvedValue(nextPage('c2')));
    await expect(fetchAllBoardItems('board', 'id', pageSize)).rejects.toThrow(/refusing to return a partial list/);
  });

  it('a 50-item page size is no longer capped at ~2,050 items', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page('c', 50));
    for (let i = 0; i < 60; i++) fetchMock.mockResolvedValueOnce(nextPage(i < 59 ? 'c' : null, 50));
    vi.stubGlobal('fetch', fetchMock);
    const items = await fetchAllBoardItems('board', 'id', 50);
    expect(items).toHaveLength(61 * 50);
  });
});

describe('isMondayTrackedUrl — SSRF guard', () => {
  it('accepts only https on the exact host', () => {
    expect(isMondayTrackedUrl('https://trackingservice.monday.com/tracker/abc')).toBe(true);
    expect(isMondayTrackedUrl('http://trackingservice.monday.com/tracker/abc')).toBe(false);
    expect(isMondayTrackedUrl('http://169.254.169.254/?x=trackingservice.monday.com')).toBe(false);
    expect(isMondayTrackedUrl('https://trackingservice.monday.com.evil.example/x')).toBe(false);
    expect(isMondayTrackedUrl('https://evil.example/trackingservice.monday.com')).toBe(false);
    expect(isMondayTrackedUrl('not a url')).toBe(false);
  });
});

describe('mondayRetryHintMs', () => {
  const headers = (v) => ({ headers: { get: (k) => (k === 'retry-after' ? v : null) } });

  it('reads "reset in N seconds" from a complexity error', () => {
    expect(mondayRetryHintMs({ errors: [{ message: 'Complexity budget exhausted, query cost 30001 budget remaining 29999 out of 10000000 reset in 23 seconds' }] })).toBe(23000);
  });
  it('reads extensions.retry_in_seconds', () => {
    expect(mondayRetryHintMs({ errors: [{ message: 'x', extensions: { retry_in_seconds: 12 } }] })).toBe(12000);
  });
  it('reads a numeric Retry-After header', () => {
    expect(mondayRetryHintMs(null, headers('7'))).toBe(7000);
  });
  it('caps at 30s and returns 0 with no hint', () => {
    expect(mondayRetryHintMs({ errors: [{ message: 'reset in 120 seconds' }] })).toBe(30000);
    expect(mondayRetryHintMs({ errors: [{ message: 'Rate limit exceeded' }] })).toBe(0);
    expect(mondayRetryHintMs(null, headers(null))).toBe(0);
  });
});

describe('describeSelection — retired SKUs', () => {
  it('shows a grandfathered SKU the catalog no longer knows instead of a blank', () => {
    const d = describeSelection({ brand: 'prismatic', code: 'RETIRED-SKU-0000' });
    expect(d.color).toBeNull();
    expect(d.retired).toBe(true);
    expect(d.label).toContain('RETIRED-SKU-0000');
    expect(d.label).toMatch(/retired/i);
  });
  it('no selection → no label', () => {
    expect(describeSelection(null)).toEqual({ color: null, label: null, retired: false });
  });
});

describe('withDetail (admin mirror overlay)', () => {
  it('overlays only mirror-derived fields, never fresher list values', () => {
    const list = { id: '1', status: 'Shipped', trackingNumber: 'NEW', colorGates: {}, pocName: '' };
    const detail = { id: '1', status: 'Incoming Order', trackingNumber: 'OLD', colorGates: { slideColor: 'Included' }, pocName: 'Pat' };
    const merged = withDetail(list, detail);
    expect(merged.status).toBe('Shipped');
    expect(merged.trackingNumber).toBe('NEW');
    expect(merged.colorGates).toEqual({ slideColor: 'Included' });
    expect(merged.pocName).toBe('Pat');
  });
  it('returns the list row unchanged with no detail', () => {
    const list = { id: '1' };
    expect(withDetail(list, undefined)).toBe(list);
  });
});
