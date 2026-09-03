import { describe, it, expect } from 'vitest';
import { resolveDeliveryContacts } from './monday';

// lib/monday.js has no broader test coverage (its real functions are almost
// entirely Monday API I/O, expensive to mock meaningfully) — this file is
// scoped to resolveDeliveryContacts specifically: a pure function added
// 2026-09-03 so AfterShip can be told a real delivery contact instead of
// just an order title (see lib/aftership.js's `contacts` param and its two
// callers, pages/api/aftership/track.js and
// pages/api/cron/accessory-tracking-sync.js).

describe('resolveDeliveryContacts', () => {
  it('prefers the customer\'s own most-recent Delivery tab submission over the CRM mirror columns', () => {
    const order = {
      pocName: 'Old CRM Name', pocEmail: 'old@crm.example.com', phone: '555-000-0000',
      deliverySnapshot: { pocName: 'Jane Customer', pocEmail: 'jane@real.example.com', pocPhone: '555-111-2222' },
    };
    const { primary, secondary } = resolveDeliveryContacts(order);
    expect(primary).toEqual({ name: 'Jane Customer', email: 'jane@real.example.com', phone: '555-111-2222' });
    expect(secondary).toBeNull();
  });

  it('falls back to the CRM mirror columns when no Delivery tab submission exists yet', () => {
    const order = { pocName: 'CRM Name', pocEmail: 'crm@example.com', phone: '555-000-0000', deliverySnapshot: null };
    const { primary } = resolveDeliveryContacts(order);
    expect(primary).toEqual({ name: 'CRM Name', email: 'crm@example.com', phone: '555-000-0000' });
  });

  it('returns primary: null when there is no contact data anywhere — never fabricates one', () => {
    const { primary } = resolveDeliveryContacts({ deliverySnapshot: null });
    expect(primary).toBeNull();
  });

  it('returns primary: null for a null/undefined order', () => {
    expect(resolveDeliveryContacts(null).primary).toBeNull();
    expect(resolveDeliveryContacts(undefined).primary).toBeNull();
  });

  it('only returns a secondary contact when the customer explicitly turned one on', () => {
    const order = {
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
    const order = { deliverySnapshot: { pocEmail: 'jane@example.com', hasSecondaryPoc: true } };
    const { secondary } = resolveDeliveryContacts(order);
    expect(secondary).toBeNull();
  });
});
