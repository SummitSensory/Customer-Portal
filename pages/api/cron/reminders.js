/**
 * GET /api/cron/reminders
 * Vercel Cron Job — runs weekdays at 8 AM Mountain (2 PM UTC).
 * Checks all orders for incomplete portal setup and sends reminder emails
 * at 3, 7, and 14 days after the portal invitation was sent.
 *
 * vercel.json schedule: "0 14 * * 1-5"
 *
 * Completion tracking: reads Monday.com tagged updates for each order.
 * Invitation date: reads [PORTAL: Invitation Sent] update timestamp.
 * Reminder tracking: logs [PORTAL: Reminder N Sent] to avoid duplicates.
 */

import { getAllOrders, getOrderMessages, postTaggedUpdate } from '../../../lib/monday';
import { sendSetupReminder } from '../../../lib/email';

const SETUP_TABS = [
  { key: 'contact',   label: 'Contact Information' },
  { key: 'billing',   label: 'Billing Information' },
  { key: 'delivery',  label: 'Delivery Details' },
  { key: 'site',      label: 'Site Readiness' },
  { key: 'color',     label: 'Color & Product Selections' },
  { key: 'documents', label: 'Required Documents' },
];

const PORTAL_TAGS = {
  contact:   'PORTAL: Contact Confirmed',
  billing:   'PORTAL: Billing Information',
  delivery:  'PORTAL: Delivery Details',
  site:      'PORTAL: Site Readiness',
  color:     'PORTAL: Color Selections',
  documents: 'PORTAL: Documents Submitted',
};

const REMINDER_DAYS = [3, 7, 14];

export default async function handler(req, res) {
  // Vercel calls this as GET; protect with a cron secret
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const results = { checked: 0, reminded: 0, errors: 0 };

  try {
    const orders = await getAllOrders(200);

    for (const order of orders) {
      if (!order.customerEmail) continue;
      results.checked++;

      try {
        const updates = await getOrderMessages(order.id);
        const bodies = updates.map(u => u.body || '');

        // Find invitation date
        const inviteUpdate = bodies.find(b => b.includes('[PORTAL: Invitation Sent]'));
        if (!inviteUpdate) continue; // No invite sent yet — skip

        const inviteDateMatch = inviteUpdate.match(/on (\d+\/\d+\/\d+)/);
        if (!inviteDateMatch) continue;
        const inviteDate = new Date(inviteDateMatch[1]);
        const daysSinceInvite = Math.floor((now - inviteDate) / (1000 * 60 * 60 * 24));

        // Determine which reminder to send (3, 7, or 14 days)
        const reminderDue = REMINDER_DAYS.find(d => {
          const alreadySent = bodies.some(b => b.includes(`[PORTAL: Reminder ${d}d Sent]`));
          return daysSinceInvite >= d && !alreadySent;
        });
        if (!reminderDue) continue;

        // Check which tabs are incomplete
        const incompleteTabs = SETUP_TABS.filter(tab => {
          const tag = PORTAL_TAGS[tab.key];
          return !bodies.some(b => b.includes(`[${tag}]`));
        });
        if (incompleteTabs.length === 0) continue; // All done — no reminder needed

        // Send the reminder
        await sendSetupReminder(
          order.customerEmail,
          order.pocName || order.firstName || '',
          order.name,
          incompleteTabs.map(t => t.label),
          REMINDER_DAYS.indexOf(reminderDue) + 1
        );

        // Log that this reminder was sent
        await postTaggedUpdate(
          order.id,
          `PORTAL: Reminder ${reminderDue}d Sent`,
          `${reminderDue}-day setup reminder sent to ${order.customerEmail} on ${now.toLocaleDateString()}.`
        );

        results.reminded++;
      } catch (orderErr) {
        console.error(`Reminder error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Cron reminders error:', err);
    return res.status(500).json({ error: 'Cron job failed.' });
  }
}
