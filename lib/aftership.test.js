import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
});
