// GET /api/cron/prismatic-invoicing
//
// Daily: puts each eligible order's Prismatic upcharge on its QuickBooks
// invoice (lib/prismaticInvoicing.js). Confirms and staff color changes
// already try straight away; this catches the ones that couldn't be placed
// then — most often because the order's unpaid invoice didn't exist yet.
//
// Orders already recorded at their current amount ("[PORTAL: Prismatic
// Invoiced]" update) are skipped without asking QuickBooks.

import { getAllOrders, getOrderMessages } from '../../../lib/monday';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { secretsMatch } from '../../../lib/auth';
import { invoicingSettings, invoicingReady, isEligible, lastRecordedAmount, runForOrder } from '../../../lib/prismaticInvoicing';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || !secretsMatch(req.headers['authorization'], `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  const settings = invoicingSettings();
  if (!invoicingReady(settings)) {
    console.log('Prismatic invoicing cron: off (QBO_INVOICING / QBO_PRISMATIC_ITEM_ID / QBO_INVOICING_START / QuickBooks credentials)');
    return res.status(200).json({ ok: true, skipped: 'off' });
  }

  const counts = {};
  const failures = [];
  try {
    const orders = (await getAllOrders({ fresh: true })).filter((o) => isEligible(o, settings));
    for (const order of orders) {
      const target = Number(order.colorSelectionSnapshot.totalUpcharge) || 0;
      const recorded = lastRecordedAmount(await getOrderMessages(order.id));
      // Nothing owed and nothing ever added, or already recorded at this amount.
      if ((target === 0 && recorded === null) || recorded === target) {
        counts.unchanged = (counts.unchanged || 0) + 1;
        continue;
      }
      try {
        const result = await runForOrder(order.id, { settings });
        counts[result.status] = (counts[result.status] || 0) + 1;
      } catch (err) {
        failures.push(`${order.name} (${order.id}): ${err.message}`);
      }
    }
  } catch (err) {
    await reportCriticalFailure('prismatic-invoicing-cron', `The daily Prismatic invoicing run failed before finishing: ${err.message}`, {});
    return res.status(500).json({ error: err.message });
  }

  console.log(`Prismatic invoicing cron summary: ${JSON.stringify(counts)} failures=${failures.length}`);
  if (failures.length) {
    await reportCriticalFailure('prismatic-invoicing-cron',
      `The daily Prismatic invoicing run couldn't reach QuickBooks for ${failures.length} order(s): ${failures.join('; ')}`,
      { failures });
  }
  return res.status(200).json({ ok: true, counts, failures: failures.length });
}
