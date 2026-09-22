import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findRecentDeliverySubmission, DELIVERY_COLS } from '../../lib/monday';

// findRecentDeliverySubmission is the cross-instance/cold-start half of the
// Delivery-submission idempotency guard (see its own header comment in
// lib/monday.js, and pages/api/portal/setup.js's PORTAL-018-IDEMPOTENCY-
// FOLLOWUP comment). It queries Monday's real Delivery & Site Details
// Submissions board directly, so these tests mock the global fetch() call
// mondayQuery ultimately makes rather than mocking lib/monday.js itself.

function makeBoardResponse(items) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { boards: [{ items_page: { cursor: null, items } }] } }),
  };
}

function col(id, text) {
  return { id, text, value: null };
}

const ORDER_ID = 'order-123';
const BASE_FIELDS = {
  pocName: 'Jane Doe', pocPhone: '555-111-2222', pocEmail: 'jane@example.com',
  specialInstructions: 'Leave at loading dock', hasSecondaryPoc: false,
  secondaryPocName: '', secondaryPocPhone: '', secondaryPocEmail: '',
  primaryCommMethods: ['Email'], secondaryCommMethods: [],
  addressConfirmed: true, addressLine1: '', addressLine2: '', addressCity: '',
  addressState: '', addressZip: '', addressCountry: '',
  formattedAddress: '123 Main St, Springfield, IL 62704',
  loadingDock: 'Yes', deliveryTiming: 'ASAP',
  freightAckBy: 'Jane Doe', changedRestricted: [],
};

function makeMatchingItem(overrides = {}) {
  const merged = { ...BASE_FIELDS, ...overrides };
  return {
    id: 'existing-item-1',
    name: 'Order 123',
    created_at: new Date().toISOString(),
    column_values: [
      col(DELIVERY_COLS.orderItemId, ORDER_ID),
      col(DELIVERY_COLS.primaryPocName, merged.pocName),
      col(DELIVERY_COLS.primaryPocPhone, merged.pocPhone),
      col(DELIVERY_COLS.primaryPocEmail, merged.pocEmail),
      col(DELIVERY_COLS.specialInstructions, merged.specialInstructions),
      col(DELIVERY_COLS.hasSecondaryPoc, merged.hasSecondaryPoc ? 'Yes' : 'No'),
      col(DELIVERY_COLS.secondaryPocName, merged.secondaryPocName),
      col(DELIVERY_COLS.secondaryPocPhone, merged.secondaryPocPhone),
      col(DELIVERY_COLS.secondaryPocEmail, merged.secondaryPocEmail),
      col(DELIVERY_COLS.primaryCommMethods, merged.primaryCommMethods.join(', ')),
      col(DELIVERY_COLS.secondaryCommMethods, merged.secondaryCommMethods.join(', ')),
      col(DELIVERY_COLS.addressConfirmed, merged.addressConfirmed ? 'Yes' : 'No'),
      col(DELIVERY_COLS.addressLine1, merged.addressLine1),
      col(DELIVERY_COLS.addressLine2, merged.addressLine2),
      col(DELIVERY_COLS.city, merged.addressCity),
      col(DELIVERY_COLS.stateProvince, merged.addressState),
      col(DELIVERY_COLS.postalCode, merged.addressZip),
      col(DELIVERY_COLS.country, merged.addressCountry),
      col(DELIVERY_COLS.formattedAddress, merged.formattedAddress),
      col(DELIVERY_COLS.loadingDock, merged.loadingDock),
      col(DELIVERY_COLS.deliveryTiming, merged.deliveryTiming),
      col(DELIVERY_COLS.freightAckBy, merged.freightAckBy),
      col(DELIVERY_COLS.restrictedChanges, merged.changedRestricted.join(', ')),
    ],
  };
}

describe('findRecentDeliverySubmission', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the matching item when a recent, content-identical submission exists for the same order', async () => {
    global.fetch.mockResolvedValue(makeBoardResponse([makeMatchingItem()]));

    const result = await findRecentDeliverySubmission(ORDER_ID, BASE_FIELDS);

    expect(result).toEqual({ id: 'existing-item-1', name: 'Order 123' });
  });

  it('returns null when no item exists for this order at all', async () => {
    global.fetch.mockResolvedValue(makeBoardResponse([]));

    const result = await findRecentDeliverySubmission(ORDER_ID, BASE_FIELDS);

    expect(result).toBeNull();
  });

  it('returns null for a matching order id whose content genuinely differs (not a duplicate — a real second submission)', async () => {
    global.fetch.mockResolvedValue(makeBoardResponse([
      makeMatchingItem({ specialInstructions: 'Actually, call ahead first.' }),
    ]));

    const result = await findRecentDeliverySubmission(ORDER_ID, BASE_FIELDS);

    expect(result).toBeNull();
  });

  it('returns null for a content-identical item belonging to a DIFFERENT order', async () => {
    const item = makeMatchingItem();
    item.column_values = item.column_values.map(c =>
      c.id === DELIVERY_COLS.orderItemId ? { ...c, text: 'some-other-order-999' } : c
    );
    global.fetch.mockResolvedValue(makeBoardResponse([item]));

    const result = await findRecentDeliverySubmission(ORDER_ID, BASE_FIELDS);

    expect(result).toBeNull();
  });

  // The dedupe window exists so a genuine second submission made long after
  // the first (not a retry) always creates its own row — this proves an
  // old, content-identical item outside the window is correctly ignored.
  it('returns null for a content-identical item that is OUTSIDE the dedupe window (a real, later resubmission)', async () => {
    const item = makeMatchingItem();
    item.created_at = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
    global.fetch.mockResolvedValue(makeBoardResponse([item]));

    const result = await findRecentDeliverySubmission(ORDER_ID, BASE_FIELDS);

    expect(result).toBeNull();
  });

  it('returns null (fails open) when DELIVERY_BOARD_ID/orderId inputs are missing rather than throwing', async () => {
    const result = await findRecentDeliverySubmission(null, BASE_FIELDS);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
