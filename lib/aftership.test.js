import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildTrackingTitle, SHIPMENT_LABELS } from './aftership';

// No test coverage existed for this file before this addition (2026-09-03),
// added alongside wiring the real customer delivery contact (name/email/
// phone — see lib/monday.js's resolveDeliveryContacts) into AfterShip's
// `customers` field via onboardShipment/trackShipment, so AfterShip's own
// native notification flows have a real recipient. Scoped to that contract
// — the request AfterShip actually receives — not a full retest of every
// existing retry/timeout path in this file.

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function jsonResponse(body, status = 201) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
}

beforeEach(() => {
  process.env.AFTERSHIP_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('onboardShipment — customers sent to AfterShip', () => {
  it('sends the real contact\'s name, email, and phone_number on a new tracking', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {
      title: 'Order #123',
      orderId: '123',
      customerName: 'Order #123', // fallback-only value; must be ignored once a real contact exists
      contacts: [{ name: 'Jane Customer', email: 'jane@example.com', phone: '555-111-2222' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customers).toEqual([
      { name: 'Jane Customer', email: 'jane@example.com', phone_number: '555-111-2222' },
    ]);
  });

  it('sends both primary and secondary contacts when both exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {
      contacts: [
        { name: 'Jane Customer', email: 'jane@example.com', phone: '555-111-2222' },
        { name: 'John Secondary', email: 'john@example.com', phone: '555-333-4444' },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customers).toHaveLength(2);
    expect(body.customers[1]).toEqual({ name: 'John Secondary', email: 'john@example.com', phone_number: '555-333-4444' });
  });

  it('falls back to a bare name-only customer when no real contact exists yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', { customerName: 'Order #123', contacts: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customers).toEqual([{ name: 'Order #123' }]);
  });

  it('sends no customers field at all when there is neither a contact nor a customerName', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {});

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customers).toBeUndefined();
  });

  it('caps at 3 customers even if more are somehow passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {
      contacts: [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com' },
        { name: 'C', email: 'c@example.com' },
        { name: 'D', email: 'd@example.com' },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customers).toHaveLength(3);
  });

  it('backfills customers onto an already-existing tracking (code 4003), not just new ones', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { code: 4003 }, data: { id: 'ast-existing' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'ast-existing' } }, 200));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {
      title: 'Order #123',
      contacts: [{ name: 'Jane Customer', email: 'jane@example.com' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putCall] = fetchMock.mock.calls;
    expect(putCall[0]).toContain('/trackings/ast-existing');
    expect(putCall[1].method).toBe('PUT');
    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.customers).toEqual([{ name: 'Jane Customer', email: 'jane@example.com' }]);
  });

  it('sends custom_fields when provided, and backfills them onto an already-existing tracking too', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { code: 4003 }, data: { id: 'ast-existing' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'ast-existing' } }, 200));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', { customFields: { shipment_type: 'Therapy Mats & Padding' } });

    const postBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postBody.custom_fields).toEqual({ shipment_type: 'Therapy Mats & Padding' });
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.custom_fields).toEqual({ shipment_type: 'Therapy Mats & Padding' });
  });

  it('sends no custom_fields key at all when none are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'ast-1' } }, 201));
    global.fetch = fetchMock;
    const { onboardShipment } = await import('./aftership');

    await onboardShipment('ups', '1Z999', {});

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.custom_fields).toBeUndefined();
  });
});

describe('buildShipmentTypeCustomField', () => {
  it('returns a shipment_type custom field for a known shipment key', async () => {
    const { buildShipmentTypeCustomField } = await import('./aftership');
    expect(buildShipmentTypeCustomField('frame')).toEqual({ shipment_type: 'Sensory Gym Frame' });
    expect(buildShipmentTypeCustomField('mats')).toEqual({ shipment_type: 'Therapy Mats & Padding' });
    expect(buildShipmentTypeCustomField('accessory')).toEqual({ shipment_type: 'Therapy Equipment & Accessories' });
  });

  it('returns an empty object for an unknown/absent shipment key', async () => {
    const { buildShipmentTypeCustomField } = await import('./aftership');
    expect(buildShipmentTypeCustomField(null)).toEqual({});
    expect(buildShipmentTypeCustomField('some-legacy-generic-tracking-field')).toEqual({});
  });
});

describe('firstNameOf', () => {
  it('returns just the first word of a full name', async () => {
    const { firstNameOf } = await import('./aftership');
    expect(firstNameOf('Jane Customer')).toBe('Jane');
    expect(firstNameOf('Jane Q. Customer')).toBe('Jane');
  });

  it('returns an empty string for a blank/missing name, never throws', async () => {
    const { firstNameOf } = await import('./aftership');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf(null)).toBe('');
    expect(firstNameOf(undefined)).toBe('');
  });
});

describe('buildCustomFields', () => {
  it('combines shipment_type and the primary contact\'s first name', async () => {
    const { buildCustomFields } = await import('./aftership');
    const contacts = [{ name: 'Jane Customer', email: 'jane@example.com' }, { name: 'John Secondary' }];
    expect(buildCustomFields('mats', contacts)).toEqual({ shipment_type: 'Therapy Mats & Padding', first_name: 'Jane' });
  });

  it('always derives first_name from the PRIMARY contact only, never the secondary', async () => {
    const { buildCustomFields } = await import('./aftership');
    const contacts = [{ name: 'Jane Customer' }, { name: 'John Secondary' }];
    expect(buildCustomFields('frame', contacts).first_name).toBe('Jane');
  });

  it('omits first_name (does not send an empty string) when there is no contact at all', async () => {
    const { buildCustomFields } = await import('./aftership');
    expect(buildCustomFields('frame', [])).toEqual({ shipment_type: 'Sensory Gym Frame' });
    expect(buildCustomFields('frame', undefined)).toEqual({ shipment_type: 'Sensory Gym Frame' });
  });

  it('still returns first_name even for a shipment key with no shipment_type label', async () => {
    const { buildCustomFields } = await import('./aftership');
    expect(buildCustomFields(null, [{ name: 'Jane Customer' }])).toEqual({ first_name: 'Jane' });
  });
});

describe('buildTrackingTitle', () => {
  // Direct requirement (2026-09-03): a customer with both a Frame and a
  // Mats shipment on one order previously got the exact same AfterShip
  // title (the bare order name) for both — nothing said which shipment a
  // given notification was about.
  it('appends the Frame label for a frame shipment', () => {
    expect(buildTrackingTitle('Waunakee CSD Order #123', 'frame')).toBe('Waunakee CSD Order #123 — Sensory Gym Frame');
  });

  it('appends the Mats label for a mats shipment', () => {
    expect(buildTrackingTitle('Waunakee CSD Order #123', 'mats')).toBe('Waunakee CSD Order #123 — Therapy Mats & Padding');
  });

  it('appends the generic Accessories label when no specific item-name detail is given', () => {
    expect(buildTrackingTitle('Waunakee CSD Order #123', 'accessory')).toBe('Waunakee CSD Order #123 — Therapy Equipment & Accessories');
  });

  it('uses the specific item name (detail) instead of the generic Accessories label when given', () => {
    expect(buildTrackingTitle('Waunakee CSD Order #123', 'accessory', 'Weighted Blanket')).toBe('Waunakee CSD Order #123 — Weighted Blanket');
  });

  it('falls back to the bare order name for an unknown/absent shipment key (e.g. a generic/legacy tracking number)', () => {
    expect(buildTrackingTitle('Waunakee CSD Order #123', null)).toBe('Waunakee CSD Order #123');
    expect(buildTrackingTitle('Waunakee CSD Order #123', 'some-legacy-generic-tracking-field')).toBe('Waunakee CSD Order #123');
  });

  it('falls back to just the detail/label when there is no order name at all, rather than returning undefined', () => {
    expect(buildTrackingTitle(undefined, 'accessory', 'Weighted Blanket')).toBe('Weighted Blanket');
    expect(buildTrackingTitle(undefined, 'frame')).toBe('Sensory Gym Frame');
  });

  it('returns undefined (not a garbage string) when there is no order name, key, or detail at all', () => {
    expect(buildTrackingTitle(undefined, null)).toBeUndefined();
    expect(buildTrackingTitle('', null)).toBeUndefined();
  });

  it('SHIPMENT_LABELS stays the single source of truth used by both the AfterShip title and our own Resend email copy', () => {
    expect(SHIPMENT_LABELS).toEqual({
      frame: 'Sensory Gym Frame',
      mats: 'Therapy Mats & Padding',
      accessory: 'Therapy Equipment & Accessories',
    });
  });
});
