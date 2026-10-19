/**
 * Prismatic upcharges → the customer's QuickBooks invoice, automatically.
 *
 * Bryan's rules (2026-10-19):
 *   - Add the upcharge only to the order's ONE completely unpaid invoice. No
 *     such invoice (or more than one) → change nothing, alert staff once, and
 *     try again on the next daily run.
 *   - Upcharge lowered later (a staff color change) → adjust or remove the
 *     portal's line while that invoice is still unpaid; once it's paid, alert
 *     staff to credit it by hand.
 *   - Only orders whose colors were confirmed after go-live
 *     (QBO_INVOICING_START). Older ones may already have been invoiced by
 *     hand, so they're listed for staff instead (olderPrismaticOrders).
 *
 * Nothing in Monday holds a QuickBooks id, so the customer is found by the
 * order's email (exact, else exact display name = order name) and must be
 * exactly one. The portal's own line is recognised by a marker in its
 * description, "[portal order <id>]" — QuickBooks itself is the record of
 * what was added, so a lost Monday write can't cause a second charge, and a
 * Prismatic line someone added by hand (no marker) stops the run for review.
 *
 * Off unless QBO_INVOICING=on, with QBO_PRISMATIC_ITEM_ID (the QuickBooks
 * product/service the line uses) and QBO_INVOICING_START set.
 */

import { createHash } from 'crypto';
import * as defaultQb from './quickbooks';
import { getOrderById, getOrderMessages, postTaggedUpdate, hasNotifiedValue, markNotifiedValue } from './monday';
import { reportCriticalFailure } from './monitoring';

export const INVOICED_TAG = 'PORTAL: Prismatic Invoiced';
const ALERT_KIND = 'Prismatic Invoice Alert';

export function invoicingSettings(env = process.env) {
  const start = env.QBO_INVOICING_START ? new Date(env.QBO_INVOICING_START) : null;
  return {
    enabled: (env.QBO_INVOICING || '').toLowerCase() === 'on',
    itemId: env.QBO_PRISMATIC_ITEM_ID || null,
    taxCode: env.QBO_PRISMATIC_TAX_CODE || null,
    start: start && !Number.isNaN(start.getTime()) ? start : null,
  };
}

export function invoicingReady(settings = invoicingSettings(), qb = defaultQb) {
  return settings.enabled && !!settings.itemId && !!settings.start && qb.quickbooksConfigured();
}

/** Orders this runs for: colors confirmed (in the portal) on/after go-live. */
export function isEligible(order, settings = invoicingSettings()) {
  const confirmedAt = order?.colorSelectionSnapshot?.confirmedAt;
  if (!confirmedAt || !settings.start) return false;
  return new Date(confirmedAt) >= settings.start;
}

export function lineMarker(orderId) {
  return `[portal order ${orderId}]`;
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const isUnpaid = (inv) => Number(inv.TotalAmt) > 0 && Number(inv.Balance) === Number(inv.TotalAmt);
const isSalesLine = (line) => line.DetailType === 'SalesItemLineDetail';

function portalLines(invoice, orderId) {
  return (invoice.Line || []).filter((l) => isSalesLine(l) && (l.Description || '').includes(lineMarker(orderId)));
}

function handPrismaticLines(invoice, orderId) {
  return (invoice.Line || []).filter((l) => isSalesLine(l)
    && !(l.Description || '').includes(lineMarker(orderId))
    && /prismatic/i.test(`${l.Description || ''} ${l.SalesItemLineDetail?.ItemRef?.name || ''}`));
}

// Lines to send back: everything as read except the computed subtotal.
function keptLines(invoice) {
  return (invoice.Line || []).filter((l) => l.DetailType !== 'SubTotalLineDetail');
}

function newLine(orderId, amount, settings) {
  return {
    DetailType: 'SalesItemLineDetail',
    Amount: amount,
    Description: `Prismatic paint color upcharge ${lineMarker(orderId)}`,
    SalesItemLineDetail: {
      ItemRef: { value: String(settings.itemId) },
      Qty: 1,
      UnitPrice: amount,
      ...(settings.taxCode ? { TaxCodeRef: { value: settings.taxCode } } : {}),
    },
  };
}

async function findCustomer(order, qb) {
  if (order.customerEmail) {
    const byEmail = await qb.findCustomersByEmail(order.customerEmail);
    if (byEmail.length === 1) return { customer: byEmail[0] };
    if (byEmail.length > 1) return { problem: `${byEmail.length} QuickBooks customers have the email ${order.customerEmail}` };
  }
  const byName = order.name ? await qb.findCustomersByName(order.name) : [];
  if (byName.length === 1) return { customer: byName[0] };
  if (byName.length > 1) return { problem: `${byName.length} QuickBooks customers are named "${order.name}"` };
  return { problem: `no QuickBooks customer has the email ${order.customerEmail || '(none on the order)'} or the name "${order.name}"` };
}

/**
 * Make the order's QuickBooks invoices carry exactly its current Prismatic
 * upcharge (colorSelectionSnapshot.totalUpcharge). Returns
 * { status, message, invoice?, amount? } — status is one of:
 *   'in_sync'      already right, nothing changed
 *   'added' | 'adjusted' | 'removed'   an invoice was changed
 *   'pending'      can't place it yet (no single unpaid invoice / customer) — retried
 *   'needs_review' staff must act (paid invoice, a hand-added Prismatic line, …)
 *   'skipped'      not eligible
 */
export async function reconcileOrder(order, { qb = defaultQb, settings = invoicingSettings() } = {}) {
  if (!isEligible(order, settings)) return { status: 'skipped', message: 'colors confirmed before automatic invoicing started' };
  const target = Number(order.colorSelectionSnapshot.totalUpcharge) || 0;

  const { customer, problem } = await findCustomer(order, qb);
  if (!customer) {
    return target > 0
      ? { status: 'pending', message: `couldn't find the customer in QuickBooks: ${problem}` }
      : { status: 'in_sync', message: 'no upcharge' };
  }

  const invoices = await qb.getCustomerInvoices(customer.Id);
  const withOurs = invoices.filter((inv) => portalLines(inv, order.id).length);
  if (withOurs.length > 1) {
    return { status: 'needs_review', message: `the portal's Prismatic line appears on ${withOurs.length} invoices (#${withOurs.map((i) => i.DocNumber || i.Id).join(', #')}) — remove the extra one` };
  }

  if (withOurs.length === 1) {
    const invoice = withOurs[0];
    const ours = portalLines(invoice, order.id);
    const current = ours.reduce((sum, l) => sum + Number(l.Amount || 0), 0);
    if (ours.length === 1 && current === target) return { status: 'in_sync', message: `${money(target)} is on invoice #${invoice.DocNumber || invoice.Id}`, invoice, amount: target };
    if (!isUnpaid(invoice)) {
      return { status: 'needs_review', message: `the upcharge is now ${money(target)} but invoice #${invoice.DocNumber || invoice.Id} (with ${money(current)}) has a payment on it — adjust it by hand (credit memo or new charge)`, invoice, amount: target };
    }
    const others = keptLines(invoice).filter((l) => !ours.includes(l));
    const lines = target > 0 ? [...others, { ...newLine(order.id, target, settings), ...(ours[0].Id ? { Id: ours[0].Id } : {}) }] : others;
    const updated = await qb.updateInvoiceLines(invoice, lines);
    return {
      status: target > 0 ? 'adjusted' : 'removed',
      message: target > 0
        ? `changed the Prismatic upcharge on invoice #${invoice.DocNumber || invoice.Id} from ${money(current)} to ${money(target)}`
        : `removed the ${money(current)} Prismatic upcharge from invoice #${invoice.DocNumber || invoice.Id}`,
      invoice: updated || invoice,
      amount: target,
      previous: current,
    };
  }

  if (target <= 0) return { status: 'in_sync', message: 'no upcharge' };

  const unpaid = invoices.filter(isUnpaid);
  if (unpaid.length !== 1) {
    return {
      status: 'pending',
      message: unpaid.length
        ? `${unpaid.length} unpaid invoices for ${customer.DisplayName} (#${unpaid.map((i) => i.DocNumber || i.Id).join(', #')}) — can't tell which one is this order's`
        : `${customer.DisplayName} has no completely unpaid invoice in QuickBooks yet`,
      amount: target,
    };
  }
  const invoice = unpaid[0];
  const byHand = handPrismaticLines(invoice, order.id);
  if (byHand.length) {
    return { status: 'needs_review', message: `invoice #${invoice.DocNumber || invoice.Id} already has a Prismatic line someone added by hand ("${byHand[0].Description || byHand[0].SalesItemLineDetail?.ItemRef?.name}") — check it's ${money(target)}`, invoice, amount: target };
  }
  const updated = await qb.updateInvoiceLines(invoice, [...keptLines(invoice), newLine(order.id, target, settings)]);
  return { status: 'added', message: `added the ${money(target)} Prismatic upcharge to invoice #${invoice.DocNumber || invoice.Id} (${customer.DisplayName})`, invoice: updated || invoice, amount: target };
}

/** The amount in the newest "[PORTAL: Prismatic Invoiced]" update, or null. */
export function lastRecordedAmount(updates) {
  const recorded = (updates || [])
    .map((u) => ({ at: u.created_at, match: String(u.body || '').match(new RegExp(`^\\[${INVOICED_TAG}\\][\\s\\S]*?amount: \\$([\\d.]+)`)) }))
    .filter((u) => u.match)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  return recorded.length ? Number(recorded[0].match[1]) : null;
}

/**
 * Run one order end to end: reconcile, record a change on the order, and
 * alert staff (once per distinct problem) when it can't be done. Safe to call
 * from several places at once — QuickBooks refuses a write from an
 * out-of-date copy, and a refused write is retried once from a fresh read.
 */
export async function runForOrder(orderId, { qb = defaultQb, settings = invoicingSettings(), order: given = null } = {}) {
  if (!invoicingReady(settings, qb)) return { status: 'skipped', message: 'automatic Prismatic invoicing is off' };
  const order = given || await getOrderById(orderId);
  if (!order) return { status: 'skipped', message: 'order not found' };

  let result;
  try {
    result = await reconcileOrder(order, { qb, settings });
  } catch (err) {
    if (!err.stale) throw err;
    result = await reconcileOrder(order, { qb, settings });
  }

  if (['added', 'adjusted', 'removed'].includes(result.status)) {
    const doc = result.invoice?.DocNumber || result.invoice?.Id;
    await postTaggedUpdate(order.id, INVOICED_TAG,
      `QuickBooks invoice #${doc}: ${result.message}.\namount: ${money(result.amount)}`
    ).catch((err) => console.error('prismatic-invoicing: recording the change on the order failed:', err.message));
  } else if (result.status === 'in_sync' && result.invoice) {
    // Recorded so the daily run can skip it without asking QuickBooks.
    const updates = await getOrderMessages(order.id).catch(() => []);
    if (lastRecordedAmount(updates) !== Number(result.amount)) {
      await postTaggedUpdate(order.id, INVOICED_TAG, `QuickBooks invoice #${result.invoice.DocNumber || result.invoice.Id}: ${result.message}.\namount: ${money(result.amount)}`)
        .catch(() => {});
    }
  } else if (result.status === 'pending' || result.status === 'needs_review') {
    // A short hash, not the message itself: Monday HTML-escapes quotes and
    // the like in update bodies, which would defeat the startsWith match in
    // hasNotifiedValue and re-alert every day.
    const alertKey = `${result.status} ${createHash('sha256').update(`${result.amount}|${result.message}`).digest('hex').slice(0, 12)}`;
    const alreadyAlerted = await hasNotifiedValue(order.id, ALERT_KIND, alertKey).catch(() => false);
    if (!alreadyAlerted) {
      await reportCriticalFailure(`prismatic-invoicing-${result.status}`,
        `Order ${order.id} ("${order.name}"): the ${money(result.amount ?? order.colorSelectionSnapshot?.totalUpcharge)} Prismatic upcharge ${result.status === 'pending' ? 'is not on a QuickBooks invoice yet' : 'needs a person'} — ${result.message}.${result.status === 'pending' ? ' The portal will keep trying daily; add it by hand if that invoice won\'t exist soon.' : ''}`,
        { orderId: order.id, status: result.status });
      await markNotifiedValue(order.id, ALERT_KIND, alertKey).catch(() => {});
    }
  }
  return result;
}

/**
 * Orders with a Prismatic upcharge confirmed BEFORE go-live — never charged
 * automatically (they may have been invoiced by hand); shown to staff to check.
 */
export function olderPrismaticOrders(orders, settings = invoicingSettings()) {
  return (orders || [])
    .filter((o) => o.colorSelectionSnapshot?.confirmedAt && Number(o.colorSelectionSnapshot.totalUpcharge) > 0)
    .filter((o) => !settings.start || new Date(o.colorSelectionSnapshot.confirmedAt) < settings.start)
    .map((o) => ({ id: o.id, name: o.name, amount: Number(o.colorSelectionSnapshot.totalUpcharge), confirmedAt: o.colorSelectionSnapshot.confirmedAt }));
}
