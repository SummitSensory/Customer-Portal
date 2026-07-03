/**
 * GET /api/cron/reminders
 * Vercel Cron Job — runs weekdays at 8 AM Mountain (2 PM UTC).
 *
 * vercel.json schedule: "0 14 * * 1-5"
 *
 * Sends setup reminder emails on a configurable repeating schedule until ALL
 * setup tabs are complete. Reminders stop automatically once the customer
 * finishes every step.
 *
 * Configuration (Vercel env vars):
 *   REMINDER_INTERVAL_DAYS  — days between reminders (default: 3)
 *   REMINDER_MAX_COUNT      — maximum reminders to send per customer (default: 6)
 *
 * Completion tracking:   reads Monday.com tagged updates, e.g. [PORTAL: Contact Confirmed]
 * Reminder tracking:     logs [PORTAL: Reminder #N] update to prevent duplicates
 * Invitation tracking:   reads [PORTAL: Invitation Sent] to know when the clock starts
 */

import { getAllOrders, getOrderMessages, postTaggedUpdate } from '../../../lib/monday';
import { sendSetupReminder } from '../../../lib/email';

// Must match the tabs in the portal (site is merged into delivery)
const SETUP_TABS = [
  { key: 'contact',   label: 'Contact Information' },
  { key: 'billing',   label: 'Billing Information' },
  { key: 'delivery',  label: 'Delivery & Site Details' },
  { key: 'color',     label: 'Color & Product Selections' },
  { key: 'documents', label: 'Required Documents' },
];

// Tagged update bodies that signal a tab is complete
const COMPLETION_TAGS = {
  contact:   '[PORTAL: Contact Confirmed]',
  billing:   '[PORTAL: Billing Information]',
  delivery:  '[PORTAL: Delivery Details]',
  color:     '[PORTAL: Color Selections]',
  documents: '[PORTAL: Documents Submitted]',
};

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const INTERVAL_DAYS = parseInt(process.env.REMINDER_INTERVAL_DAYS || '3', 10);
  const MAX_REMINDERS = parseInt(process.env.REMINDER_MAX_COUNT || '6', 10);

  const now = new Date();
  const results = { checked: 0, reminded: 0, skipped: 0, errors: 0 };

  try {
    const orders = await getAllOrders(200);

    for (const order of orders) {
      if (!order.customerEmail) continue;
      results.checked++;

      try {
        const updates = await getOrderMessages(order.id);
        const bodies = updates.map(u => u.body || '');

        // Find when the portal invitation was sent — this starts the reminder clock
        const inviteUpdate = updates.find(u => u.body?.includes('[PORTAL: Invitation Sent]'));
        if (!inviteUpdate) { results.skipped++; continue; }

        const inviteDate = new Date(inviteUpdate.created_at);
        const daysSinceInvite = Math.floor((now - inviteDate) / (1000 * 60 * 60 * 24));

        // Determine which tabs are still incomplete
        const incompleteTabs = SETUP_TABS.filter(tab => {
          const tag = COMPLETION_TAGS[tab.key];
          return !bodies.some(b => b.includes(tag));
        });

        // All done — no reminder needed
        if (incompleteTabs.length === 0) { results.skipped++; continue; }

        // Count how many reminders have already been sent
        const sentCount = bodies.filter(b => b.match(/\[PORTAL: Reminder #\d+\]/)).length;

        // Stop if we've hit the max
        if (sentCount >= MAX_REMINDERS) { results.skipped++; continue; }

        // Determine if the next reminder is due
        // Reminder N is due after N * INTERVAL_DAYS since the invitation
        const nextReminderDue = (sentCount + 1) * INTERVAL_DAYS;
        if (daysSinceInvite < nextReminderDue) { results.skipped++; continue; }

        // Send the reminder
        const reminderNumber = sentCount + 1;
        const customerName = order.firstName || order.pocName?.split(' ')[0] || '';

        await sendSetupReminder(
          order.customerEmail,
          customerName,
          order.name,
          incompleteTabs.map(t => t.label),
          reminderNumber
        );

        // Log this reminder so we don't send it again
        await postTaggedUpdate(
          order.id,
          `PORTAL: Reminder #${reminderNumber}`,
          `Reminder #${reminderNumber} sent to ${order.customerEmail} on ${now.toLocaleDateString()}. Incomplete: ${incompleteTabs.map(t => t.label).join(', ')}.`
        );

        results.reminded++;
      } catch (orderErr) {
        console.error(`Reminder error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, intervalDays: INTERVAL_DAYS, maxReminders: MAX_REMINDERS, ...results });
  } catch (err) {
    console.error('Cron reminders error:', err);
    return res.status(500).json({ error: 'Cron job failed.' });
  }
}
