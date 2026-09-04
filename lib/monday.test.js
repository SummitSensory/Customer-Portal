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
