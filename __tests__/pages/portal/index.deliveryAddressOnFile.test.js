// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DeliveryTab, parseCombinedAddress, addressOnFileString, addressOnFileParts } from '../../../pages/portal/index';

// 2026-09-23 Delivery & Site Details audit: a customer could click
// "Yes, this is correct" on an order with NO address on file, and the row on
// the submissions board (18421779422) went in with every ship-to column
// blank (Pediatric Therapy Associates, 2026-09-08).

describe('parseCombinedAddress', () => {
  it('handles state and zip in separate comma parts', () => {
    expect(parseCombinedAddress('2301 Rexwoods Drive, Suite 118, Raleigh, NC, 27607, United States')).toEqual({
      line1: '2301 Rexwoods Drive', line2: 'Suite 118', city: 'Raleigh', state: 'NC', zip: '27607', country: 'United States',
    });
  });

  it('still handles the normal "STATE ZIP" tail', () => {
    expect(parseCombinedAddress('1078 Headquarters Park Dr., Fenton, MO 63026, United States')).toEqual({
      line1: '1078 Headquarters Park Dr.', line2: '', city: 'Fenton', state: 'MO', zip: '63026', country: 'United States',
    });
  });

  it('does not mistake a city for a state before a bare zip', () => {
    expect(parseCombinedAddress('123 Main St, Suite 5, Springfield, 62704')).toEqual({
      line1: '123 Main St', line2: 'Suite 5', city: 'Springfield', state: '', zip: '62704', country: '',
    });
  });
});

describe('DeliveryTab — confirming the ship-to address on file', () => {
  afterEach(cleanup);

  function order(extra = {}) {
    return {
      id: 'order-1', name: 'Acme Gym',
      stages: [{ key: 'placed' }, { key: 'processing' }, { key: 'shipped' }],
      stageIndex: 0,
      ...extra,
    };
  }
  const props = { completions: {}, markComplete: () => {}, showToast: () => {}, onNext: () => {}, onBack: () => {} };

  it('disables "Yes, this is correct" when there is no address on file', () => {
    render(<DeliveryTab order={order()} {...props} />);
    expect(screen.getByRole('button', { name: /Yes, this is correct/ })).toBeDisabled();
    expect(screen.getByText(/No ship-to address on file/)).toBeTruthy();
  });

  it('shows the same address it will submit (billing snapshot wins over the raw mirror)', () => {
    render(<DeliveryTab order={order({
      billingAddressOnFile: '1 Old Rd, Oldtown, CO',
      billingSnapshot: { billingAddress: '905 Bethel Circle', billingCity: 'Waunakee', billingState: 'WI', billingZip: '53597', billingCountry: 'United States' },
    })} {...props} />);
    expect(screen.getByRole('button', { name: /Yes, this is correct/ })).not.toBeDisabled();
    expect(screen.getByText('905 Bethel Circle, Waunakee, WI 53597, United States')).toBeTruthy();
  });
});

describe('address on file (Location + Zip Code mirrors)', () => {
  it('does not append the zip a second time when the address already ends with it', () => {
    expect(addressOnFileString({ billingAddressOnFile: '2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States', billingZipOnFile: '27607' }))
      .toBe('2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States');
    expect(addressOnFileString({ billingAddressOnFile: '123 Main St, Springfield, IL', billingZipOnFile: '62704' }))
      .toBe('123 Main St, Springfield, IL 62704');
  });

  it('splits the on-file address into the Billing tab fields', () => {
    expect(addressOnFileParts({ billingAddressOnFile: '2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States', billingZipOnFile: '27607' })).toEqual({
      line1: '2301 Rexwoods Drive suite 118', line2: '', city: 'Raleigh', state: 'NC', zip: '27607', country: 'United States',
    });
  });

  it('a street-only value goes in Street with the zip in Zip', () => {
    expect(addressOnFileParts({ billingAddressOnFile: '123 Main St', billingZipOnFile: '62704' })).toEqual({
      line1: '123 Main St', line2: '', city: '', state: '', zip: '62704', country: '',
    });
  });

  it('Delivery tab lets the customer confirm a mirror-only address on file', () => {
    render(<DeliveryTab order={{
      id: 'o', name: 'Acme', stages: [{ key: 'placed' }, { key: 'shipped' }], stageIndex: 0,
      billingAddressOnFile: '2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States', billingZipOnFile: '27607',
    }} completions={{}} markComplete={() => {}} showToast={() => {}} onNext={() => {}} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: /Yes, this is correct/ })).not.toBeDisabled();
    expect(screen.getByText('2301 Rexwoods Drive suite 118, Raleigh, NC 27607, United States')).toBeTruthy();
    cleanup();
  });
});
