import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockHasNotified = vi.fn().mockResolvedValue(false);
const mockMarkNotified = vi.fn().mockResolvedValue(undefined);
const mockGetOrderMessages = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/monday', () => ({
  getOrderById: vi.fn(),
  getOrderMessages: (...a) => mockGetOrderMessages(...a),
  postTaggedUpdate: (...a) => mockPostTaggedUpdate(...a),
  hasNotifiedValue: (...a) => mockHasNotified(...a),
  markNotifiedValue: (...a) => mockMarkNotified(...a),
}));
const mockReport = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/monitoring', () => ({ reportCriticalFailure: (...a) => mockReport(...a) }));
vi.mock('../../lib/quickbooks', () => ({ quickbooksConfigured: () => true }));

const { reconcileOrder, runForOrder, isEligible, lastRecordedAmount, olderPrismaticOrders, lineMarker } = await import('../../lib/prismaticInvoicing');

const SETTINGS = { enabled: true, itemId: '42', taxCode: null, start: new Date('2026-10-20T00:00:00Z') };
const order = (total, confirmedAt = '2026-10-21T15:00:00Z') => ({
  id: '111', name: 'Acme Gym', customerEmail: 'pat@acme.org',
  colorSelectionSnapshot: { selections: {}, totalUpcharge: total, confirmedAt },
});
const productLine = { Id: '1', DetailType: 'SalesItemLineDetail', Amount: 20000, Description: 'Adventure Series', SalesItemLineDetail: { ItemRef: { value: '7', name: 'Adventure Series' } } };
const subtotal = { DetailType: 'SubTotalLineDetail', Amount: 20000 };
const invoice = (over = {}) => ({ Id: '900', DocNumber: '1050', SyncToken: '3', TotalAmt: 20000, Balance: 20000, Line: [productLine, subtotal], ...over });
const ourLine = (amount) => ({ Id: '5', DetailType: 'SalesItemLineDetail', Amount: amount, Description: `Prismatic paint color upcharge ${lineMarker('111')}`, SalesItemLineDetail: { ItemRef: { value: '42' } } });

function fakeQb({ customers = [{ Id: 'C1', DisplayName: 'Acme Gym' }], invoices = [invoice()], byName = [] } = {}) {
  return {
    quickbooksConfigured: () => true,
    findCustomersByEmail: vi.fn().mockResolvedValue(customers),
    findCustomersByName: vi.fn().mockResolvedValue(byName),
    getCustomerInvoices: vi.fn().mockResolvedValue(invoices),
    updateInvoiceLines: vi.fn(async (inv, lines) => ({ ...inv, Line: lines })),
  };
}

beforeEach(() => {
  for (const m of [mockPostTaggedUpdate, mockHasNotified, mockMarkNotified, mockReport, mockGetOrderMessages]) m.mockClear();
  mockHasNotified.mockResolvedValue(false);
});

describe('reconcileOrder — adding the upcharge', () => {
  it("adds one line to the order's single completely unpaid invoice, keeping every other line", async () => {
    const qb = fakeQb();
    const result = await reconcileOrder(order(500), { qb, settings: SETTINGS });
    expect(result.status).toBe('added');
    const [inv, lines] = qb.updateInvoiceLines.mock.calls[0];
    expect(inv.Id).toBe('900');
    expect(lines.filter((l) => l.DetailType === 'SubTotalLineDetail')).toHaveLength(0);
    expect(lines[0]).toBe(productLine);
    expect(lines[1]).toMatchObject({ Amount: 500, SalesItemLineDetail: { ItemRef: { value: '42' }, Qty: 1, UnitPrice: 500 } });
    expect(lines[1].Description).toContain(lineMarker('111'));
  });

  it('never touches a partly paid invoice — waits and says why', async () => {
    const qb = fakeQb({ invoices: [invoice({ Balance: 10000 })] });
    const result = await reconcileOrder(order(500), { qb, settings: SETTINGS });
    expect(result.status).toBe('pending');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });

  it('waits when there are two unpaid invoices (can\'t tell which is this order\'s)', async () => {
    const qb = fakeQb({ invoices: [invoice(), invoice({ Id: '901', DocNumber: '1051' })] });
    const result = await reconcileOrder(order(500), { qb, settings: SETTINGS });
    expect(result.status).toBe('pending');
    expect(result.message).toContain('#1050');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });

  it('waits when the customer is ambiguous or missing', async () => {
    let qb = fakeQb({ customers: [{ Id: 'C1' }, { Id: 'C2' }] });
    expect((await reconcileOrder(order(500), { qb, settings: SETTINGS })).status).toBe('pending');
    qb = fakeQb({ customers: [], byName: [] });
    expect((await reconcileOrder(order(500), { qb, settings: SETTINGS })).status).toBe('pending');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });

  it('falls back to an exact display-name match when no customer has the email', async () => {
    const qb = fakeQb({ customers: [], byName: [{ Id: 'C9', DisplayName: 'Acme Gym' }] });
    expect((await reconcileOrder(order(500), { qb, settings: SETTINGS })).status).toBe('added');
    expect(qb.getCustomerInvoices).toHaveBeenCalledWith('C9');
  });

  it('stops for review when someone already added a Prismatic line by hand', async () => {
    const hand = { Id: '2', DetailType: 'SalesItemLineDetail', Amount: 500, Description: 'Prismatic paint upgrade', SalesItemLineDetail: { ItemRef: { value: '8' } } };
    const qb = fakeQb({ invoices: [invoice({ Line: [productLine, hand] })] });
    const result = await reconcileOrder(order(500), { qb, settings: SETTINGS });
    expect(result.status).toBe('needs_review');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });

  it('is a no-op when its line is already there at the right amount (no double charge)', async () => {
    const qb = fakeQb({ invoices: [invoice({ Line: [productLine, ourLine(500)], TotalAmt: 20500, Balance: 20500 })] });
    const result = await reconcileOrder(order(500), { qb, settings: SETTINGS });
    expect(result.status).toBe('in_sync');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });

  it('skips orders confirmed before go-live', async () => {
    const qb = fakeQb();
    expect((await reconcileOrder(order(500, '2026-09-25T01:42:41Z'), { qb, settings: SETTINGS })).status).toBe('skipped');
    expect(qb.findCustomersByEmail).not.toHaveBeenCalled();
  });
});

describe('reconcileOrder — the upcharge changes after it was added', () => {
  const invoicedAt = (amount, over = {}) => invoice({ Line: [productLine, ourLine(amount)], TotalAmt: 20000 + amount, Balance: 20000 + amount, ...over });

  it('adjusts its own line in place while the invoice is unpaid', async () => {
    const qb = fakeQb({ invoices: [invoicedAt(500)] });
    const result = await reconcileOrder(order(800), { qb, settings: SETTINGS });
    expect(result.status).toBe('adjusted');
    const [, lines] = qb.updateInvoiceLines.mock.calls[0];
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ Id: '5', Amount: 800 });
  });

  it('removes its line when the upcharge drops to $0', async () => {
    const qb = fakeQb({ invoices: [invoicedAt(500)] });
    const result = await reconcileOrder(order(0), { qb, settings: SETTINGS });
    expect(result.status).toBe('removed');
    const [, lines] = qb.updateInvoiceLines.mock.calls[0];
    expect(lines).toEqual([productLine]);
  });

  it('never edits a paid invoice — asks staff to credit it', async () => {
    const qb = fakeQb({ invoices: [invoicedAt(500, { Balance: 0 })] });
    const result = await reconcileOrder(order(0), { qb, settings: SETTINGS });
    expect(result.status).toBe('needs_review');
    expect(qb.updateInvoiceLines).not.toHaveBeenCalled();
  });
});

describe('runForOrder', () => {
  it('records a change on the order', async () => {
    const qb = fakeQb();
    await runForOrder('111', { qb, settings: SETTINGS, order: order(500) });
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('111', 'PORTAL: Prismatic Invoiced', expect.stringContaining('amount: $500.00'));
  });

  it('alerts staff once per problem, not every day', async () => {
    const qb = fakeQb({ invoices: [] });
    await runForOrder('111', { qb, settings: SETTINGS, order: order(500) });
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockMarkNotified).toHaveBeenCalledTimes(1);
    mockHasNotified.mockResolvedValue(true);
    await runForOrder('111', { qb, settings: SETTINGS, order: order(500) });
    expect(mockReport).toHaveBeenCalledTimes(1);
  });

  it('retries once from a fresh read when QuickBooks refuses a stale write — and then finds its own line', async () => {
    const qb = fakeQb();
    const stale = Object.assign(new Error('Stale Object Error'), { stale: true });
    qb.updateInvoiceLines.mockRejectedValueOnce(stale);
    qb.getCustomerInvoices
      .mockResolvedValueOnce([invoice()])
      .mockResolvedValueOnce([invoice({ Line: [productLine, ourLine(500)], TotalAmt: 20500, Balance: 20500 })]);
    const result = await runForOrder('111', { qb, settings: SETTINGS, order: order(500) });
    expect(result.status).toBe('in_sync');
    expect(qb.updateInvoiceLines).toHaveBeenCalledTimes(1);
  });

  it('does nothing while switched off', async () => {
    const qb = fakeQb();
    const result = await runForOrder('111', { qb, settings: { ...SETTINGS, enabled: false }, order: order(500) });
    expect(result.status).toBe('skipped');
    expect(qb.findCustomersByEmail).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('isEligible only from go-live on', () => {
    expect(isEligible(order(500), SETTINGS)).toBe(true);
    expect(isEligible(order(500, '2026-10-19T23:59:59Z'), SETTINGS)).toBe(false);
    expect(isEligible({ colorSelectionSnapshot: { confirmedAt: null } }, SETTINGS)).toBe(false);
  });

  it('lastRecordedAmount reads the newest record, as Monday stores it', () => {
    const updates = [
      { created_at: '2026-10-21T00:00:00Z', body: '[PORTAL: Prismatic Invoiced]<br>QuickBooks invoice #1050: added.<br>amount: $500.00' },
      { created_at: '2026-10-22T00:00:00Z', body: '[PORTAL: Prismatic Invoiced]<br>QuickBooks invoice #1050: changed.<br>amount: $800.00' },
      { created_at: '2026-10-23T00:00:00Z', body: '[PORTAL: Color Selections]<br>amount: $1.00' },
    ];
    expect(lastRecordedAmount(updates)).toBe(800);
    expect(lastRecordedAmount([])).toBeNull();
  });

  it('olderPrismaticOrders lists pre-go-live upcharges for a manual check', () => {
    const list = olderPrismaticOrders([
      { id: 'a', name: 'Bloom', colorSelectionSnapshot: { totalUpcharge: 500, confirmedAt: '2026-09-25T01:42:41Z' } },
      { id: 'b', name: 'New', colorSelectionSnapshot: { totalUpcharge: 500, confirmedAt: '2026-10-21T00:00:00Z' } },
      { id: 'c', name: 'Cardinal only', colorSelectionSnapshot: { totalUpcharge: 0, confirmedAt: '2026-09-25T00:00:00Z' } },
    ], SETTINGS);
    expect(list.map((o) => o.name)).toEqual(['Bloom']);
  });
});
