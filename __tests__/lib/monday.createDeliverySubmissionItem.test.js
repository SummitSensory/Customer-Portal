import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDeliverySubmissionItem, DELIVERY_COLS } from '../../lib/monday';

// createDeliverySubmissionItem writes one row to the Delivery & Site Details
// Submissions board (18421779422). Asserts every submitted field reaches its
// real column, by mocking the global fetch() that mondayQuery makes.

const ORDER = { id: '12964352339', name: 'Diverse Options (Adventure Series)' };
const FIELDS = {
  customerEmail: 'cust@example.com',
  pocName: 'Susan Osteen', pocPhone: '19207486717', phoneCanText: true, pocEmail: 'poc@example.com',
  specialInstructions: 'Call ahead',
  hasSecondaryPoc: true, secondaryPocName: 'Sam', secondaryPocPhone: '555', secondaryPhoneCanText: false, secondaryPocEmail: 'sam@example.com',
  primaryCommMethods: ['Email', 'Text Message'], primaryMobilePhone: '19207486717',
  secondaryCommMethods: ['Email'], secondaryMobilePhone: '',
  addressConfirmed: true, addressLine1: '571 Fenton Street', addressLine2: '', addressCity: 'Ripon',
  addressState: 'WI', addressZip: '54971', addressCountry: 'United States',
  formattedAddress: '571 Fenton Street, Ripon, WI 54971, United States',
  loadingDock: 'Yes, No need for lift gate delivery', deliveryTiming: 'Schedule delivery on or after 2026-11-06',
  preferredDeliveryDate: '2026-11-06',
  freightAckBy: 'Susan Osteen', freightAckDate: '2026-09-22',
  changedRestricted: ['Ship-To Address'],
};

function ok(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

describe('createDeliverySubmissionItem', () => {
  let writes;
  beforeEach(() => {
    writes = {};
    process.env.MONDAY_BOARD_ID = '6533700776';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('create_item')) {
        // Created blank on purpose — see the comment in createDeliverySubmissionItem.
        expect(body.variables.columnValues).toBeUndefined();
        return ok({ create_item: { id: 'new-1' } });
      }
      writes[body.variables.columnId] = JSON.parse(body.variables.value);
      return ok({ change_column_value: { id: 'new-1' } });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes every submitted field to its board column', async () => {
    const id = await createDeliverySubmissionItem(ORDER, FIELDS);
    expect(id).toBe('new-1');
    const w = writes;
    expect(w[DELIVERY_COLS.orderItemId]).toBe(ORDER.id);
    expect(w[DELIVERY_COLS.orderRecordLink].url).toContain(`/pulses/${ORDER.id}`);
    expect(w[DELIVERY_COLS.customerEmail]).toBe('cust@example.com');
    expect(w[DELIVERY_COLS.submittedDate].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w[DELIVERY_COLS.primaryPocName]).toBe('Susan Osteen');
    expect(w[DELIVERY_COLS.primaryPocPhone]).toBe('19207486717');
    expect(w[DELIVERY_COLS.primaryPocCanText]).toEqual({ checked: 'true' });
    expect(w[DELIVERY_COLS.primaryPocEmail]).toBe('poc@example.com');
    expect(w[DELIVERY_COLS.specialInstructions]).toEqual({ text: 'Call ahead' });
    expect(w[DELIVERY_COLS.hasSecondaryPoc]).toBe('Yes');
    expect(w[DELIVERY_COLS.secondaryPocName]).toBe('Sam');
    expect(w[DELIVERY_COLS.secondaryPocPhone]).toBe('555');
    expect(w[DELIVERY_COLS.secondaryPocCanText]).toEqual({ checked: 'false' });
    expect(w[DELIVERY_COLS.secondaryPocEmail]).toBe('sam@example.com');
    expect(w[DELIVERY_COLS.primaryCommMethods]).toBe('Email, Text Message');
    expect(w[DELIVERY_COLS.primaryMobileForText]).toBe('19207486717');
    expect(w[DELIVERY_COLS.secondaryCommMethods]).toBe('Email');
    // Exact string the board's "Loading Dock/Lift Gate" formula column keys on.
    expect(w[DELIVERY_COLS.loadingDock]).toBe('Yes, No need for lift gate delivery');
    expect(w[DELIVERY_COLS.deliveryTiming]).toBe('Schedule delivery on or after 2026-11-06');
    expect(w[DELIVERY_COLS.preferredDeliveryDate]).toEqual({ date: '2026-11-06' });
    expect(w[DELIVERY_COLS.addressConfirmed]).toBe('Yes');
    expect(w[DELIVERY_COLS.addressLine1]).toBe('571 Fenton Street');
    expect(w[DELIVERY_COLS.city]).toBe('Ripon');
    expect(w[DELIVERY_COLS.stateProvince]).toBe('WI');
    expect(w[DELIVERY_COLS.postalCode]).toBe('54971');
    expect(w[DELIVERY_COLS.country]).toBe('United States');
    expect(w[DELIVERY_COLS.formattedAddress]).toEqual({ text: FIELDS.formattedAddress });
    expect(w[DELIVERY_COLS.freightAckBy]).toBe('Susan Osteen');
    expect(w[DELIVERY_COLS.freightAckDate]).toEqual({ date: '2026-09-22' });
    expect(w[DELIVERY_COLS.restrictedChanges]).toEqual({ text: 'Ship-To Address' });
  });
});
