/**
 * GET /api/cron/reminders
 * Vercel Cron Job — runs weekdays at 8 AM Mountain (2 PM UTC).
 *
 * vercel.json schedule: "0 14 * * 1-5"
 *
 * Sends setup reminder emails on a configurable repeating schedule until ALL
 * setup tabs are complete. Reminders stop automatically once the customer
 * finishes every step. Re-sending the invitation restarts the cycle; an
 * order that uses up every reminder is reported to staff once.
 *
 * Configuration (Vercel env vars):
 *   REMINDER_INTERVAL_DAYS  — days between reminders (default: 3)
 *   REMINDER_MAX_COUNT      — maximum reminders to send per customer (default: 6)
 *
 * Completion tracking:   reads Monday.com tagged updates, e.g. [PORTAL: Contact Confirmed]
 * Reminder tracking:     logs [PORTAL: Reminder #N] update to prevent duplicates
 * Invitation tracking:   reads the LATEST [PORTAL: Invitation Sent] — the cycle start
 * Escalation tracking:   logs [PORTAL: Reminders Exhausted] once per cycle
 */

import { getAllOrders, getOrderMessages, postTaggedUpdate, getCustomerFirstName } from '../../../lib/monday';
import { sendSetupReminder, sendCombinedSetupReminder, notifyTeamRemindersExhausted } from '../../../lib/email';
import { reportCriticalFailure } from '../../../lib/monitoring';
import { mapWithConcurrency } from '../../../lib/concurrency';
import { hasBounced } from '../../../lib/bounces';
import { isStaffEmail, secretsMatch } from '../../../lib/auth';

// AUDIT-2026-10-06: without this, Vercel's default function limit can cut a
// run off mid-loop. 300s is within the Pro plan limit (the 30-minute/hourly
// cron schedules in vercel.json already require Pro; Hobby is daily-only).
export const config = { maxDuration: 300 };

// Orders were previously processed one at a time; this run took as long as
// (order count) × (message fetch + reminder send latency). 8 concurrent
// orders kept under Monday/AfterShip's rate limits, but on 2026-09-28 several
// concurrent update-history reads timed out; 4 (with completed orders now
// skipped before any fetch) keeps the run short without piling on Monday.
const REMINDER_CONCURRENCY = 4;

// Must match the tabs in the portal (site is merged into delivery)
const SETUP_TABS = [
  { key: 'contact',   label: 'Contact Information' },
  { key: 'billing',   label: 'Billing Information' },
  { key: 'delivery',  label: 'Delivery & Site Details' },
  { key: 'color',     label: 'Color & Product Selections' },
];

// Maps each reminder tab key to its key in order.progress (lib/monday.js's
// parseOrderItem — sourced from the durable Portal: Contact/Billing/Delivery/
// Colors status columns, flipped by markSectionComplete whenever a
// tab's setup POST succeeds). Previously this cron scanned tagged-update
// bodies for one specific legacy phrase per tab (e.g. exactly
// "[PORTAL: Contact Confirmed]") — but a customer who used the "edit and
// submit changes" path on the Contact tab instead posts
// "[PORTAL: Contact Update Requested]", which never matched, even though
// markSectionComplete had already flipped the real status column to ✅. That
// mismatch is confirmed on Kalen Siddens' order: Monday shows Portal: Contact
// ✅ since 2026-08-13, but this cron told him on 2026-08-17 that Contact
// Information was still incomplete. Reading order.progress directly — the
// same source of truth the portal UI itself now uses (see mergeProgress in
// pages/portal/index.js) — instead of re-deriving completion from free-text
// logs, fixes this for good and can't drift out of sync again.
const PROGRESS_KEYS = { contact: 'contact', billing: 'billing', delivery: 'delivery', color: 'colors' };

// "N/A" is how staff mark a step that doesn't apply to an order. It used to
// count as incomplete here, so an order with every step N/A got the "order on
// hold" email listing every step (2026-09-28).
export const DONE_LABELS = new Set(['✅', 'N/A']);

// Manufacturing Phase labels that mean the order is already past customer
// setup — staff have the details (often gathered outside the portal) or the
// order is shipped / closed. No setup reminders once an order reaches one:
// Wiggle Room got "Order on hold — manufacturing cannot begin" on 2026-09-28
// while at GB Fab Details Sent. Any phase NOT listed (Incoming Order, Color
// Details Needed, Waiting on Customer Info, a new label…) keeps reminding.
// Override with REMINDER_STOP_PHASES (comma-separated labels).
const DEFAULT_STOP_PHASES = [
  'Details Obtained', 'Ready for Manufacturing', 'GB Fab Details Sent',
  'Great Mats Order Submitted', 'RES Order Submitted', 'Sports Play Order Submitted',
  'Needs Install Drawing', 'Install Doc Sent', 'Shipped', 'Order Complete',
  'ORDER CANCELLED', 'No Action Needed',
];
export function stopPhases() {
  const raw = process.env.REMINDER_STOP_PHASES;
  return new Set((raw ? raw.split(',') : DEFAULT_STOP_PHASES).map(s => s.trim()).filter(Boolean));
}

const DAY_MS = 24 * 60 * 60 * 1000;
// The cron runs once a weekday at 14:00 UTC, and the previous reminder was
// logged a minute or two after a previous run — so "3 days later" lands a few
// minutes SHORT of 72h. Without slack every reminder slipped a whole run.
const DUE_SLACK_MS = 6 * 60 * 60 * 1000;

const INVITE_TAG = '[PORTAL: Invitation Sent]';
const REMINDER_RE = /\[PORTAL: Reminder #\d+\]/;
const EXHAUSTED_TAG = '[PORTAL: Reminders Exhausted]';
export const EXHAUSTED_LABEL = 'PORTAL: Reminders Exhausted';

/**
 * What to do for one incomplete order, from its Monday update history.
 * Pure — no I/O — so the scheduling rules are tested directly.
 *
 * The cycle starts at the LATEST invitation: only reminders logged after it
 * count, so re-sending the invite from Monday restarts reminders. (Counting
 * every reminder ever sent meant Brighton Central School District, capped
 * out on 2026-09-02, still got nothing after staff re-invited on 2026-10-01.)
 *
 * Each reminder is due `intervalDays` after the PREVIOUS email (the last
 * reminder, or the invite) — not N × interval after the invite, which after
 * a few missed weekday runs sent Brighton's reminders #2–#6 within 9 days.
 *
 * Returns { action: 'no-invite' | 'wait' | 'send' | 'exhausted' | 'escalated', number? }.
 */
export function reminderDecision(updates, now, intervalDays, maxReminders) {
  const at = (u) => new Date(u.created_at).getTime();
  const invites = updates.filter(u => (u.body || '').includes(INVITE_TAG));
  if (!invites.length) return { action: 'no-invite' };
  const cycleStart = Math.max(...invites.map(at));
  const inCycle = updates.filter(u => at(u) >= cycleStart);
  const reminders = inCycle.filter(u => REMINDER_RE.test(u.body || ''));
  const lastEmail = Math.max(cycleStart, ...reminders.map(at));
  const due = now.getTime() - lastEmail >= intervalDays * DAY_MS - DUE_SLACK_MS;

  if (reminders.length >= maxReminders) {
    if (inCycle.some(u => (u.body || '').includes(EXHAUSTED_TAG))) return { action: 'escalated' };
    // Reported when the next reminder WOULD have gone out — the customer
    // has had the full interval to act on the last one.
    return due ? { action: 'exhausted' } : { action: 'wait' };
  }
  if (!due) return { action: 'wait' };
  return { action: 'send', number: reminders.length + 1 };
}

export function incompleteSetupTabs(order) {
  return SETUP_TABS.filter(tab => !DONE_LABELS.has(order.progress?.[PROGRESS_KEYS[tab.key]]));
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // PORTAL-033: an unset CRON_SECRET used to make this a literal string
  // comparison against "Bearer undefined" — trivially satisfiable by
  // anyone. Fail closed when the secret itself isn't configured, matching
  // the discipline lib/auth.js already applies to NEXTAUTH_SECRET.
  // AUDIT-2026-10-06: constant-time compare (secretsMatch) instead of `!==`.
  if (!process.env.CRON_SECRET || !secretsMatch(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const INTERVAL_DAYS = parseInt(process.env.REMINDER_INTERVAL_DAYS || '3', 10);
  const MAX_REMINDERS = parseInt(process.env.REMINDER_MAX_COUNT || '6', 10);

  const now = new Date();
  const results = { checked: 0, reminded: 0, skipped: 0, errors: 0, exhausted: 0 };
  const exhaustedOrders = [];
  const dueReminders = [];
  const STOP_PHASES = stopPhases();

  try {
    const orders = await getAllOrders();
    const withEmail = orders.filter(o => o.customerEmail);
    results.checked = withEmail.length;

    // Two passes. First decide, per order (concurrently), which reminders are
    // due. Then send ONE email per customer address: a customer with two
    // orders due the same day (Box Butte General Hospital has two) used to
    // get two reminders seconds apart.
    await mapWithConcurrency(withEmail, REMINDER_CONCURRENCY, async (order) => {
      try {
        // Determine which tabs are still incomplete — read directly from the
        // durable Portal:* status columns (order.progress), not from
        // free-text update history (see PROGRESS_KEYS comment above).
        // Checked BEFORE fetching the update history: it needs no Monday
        // call, and fetching history for every order (most of them done)
        // timed out on Monday several times per run (2026-09-28).
        if (STOP_PHASES.has((order.status || '').trim())) { results.skipped++; return; }
        // Test orders use a staff address ("Maurer Therapy Test" → sales@
        // got real reminders) — never remind ourselves.
        if (isStaffEmail(order.customerEmail)) { results.skipped++; return; }
        const incompleteTabs = incompleteSetupTabs(order);

        // All done — no reminder needed
        if (incompleteTabs.length === 0) { results.skipped++; return; }

        const updates = await getOrderMessages(order.id);
        // A dead address (see pages/api/resend/webhook.js) — the team was
        // already alerted; reminders resume once the order's email is fixed.
        if (hasBounced(updates, order.customerEmail)) { results.skipped++; return; }
        const decision = reminderDecision(updates, now, INTERVAL_DAYS, MAX_REMINDERS);

        if (decision.action === 'exhausted') {
          exhaustedOrders.push({ id: order.id, name: order.name, customerEmail: order.customerEmail, incomplete: incompleteTabs.map(t => t.label) });
          results.skipped++;
          return;
        }
        if (decision.action !== 'send') { results.skipped++; return; }
        dueReminders.push({ order, labels: incompleteTabs.map(t => t.label), number: decision.number });
      } catch (orderErr) {
        console.error(`Reminder error for order ${order.id}:`, orderErr);
        results.errors++;
      }
    });

    const byCustomer = new Map();
    for (const d of dueReminders) {
      const key = d.order.customerEmail.toLowerCase().trim();
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key).push(d);
    }

    await mapWithConcurrency([...byCustomer.values()], REMINDER_CONCURRENCY, async (group) => {
      const first = group[0].order;
      const customerName = await getCustomerFirstName(first);
      let sent;
      try {
        sent = group.length === 1
          ? await sendSetupReminder(first.customerEmail, customerName, first.name, group[0].labels, group[0].number)
          : await sendCombinedSetupReminder(
            first.customerEmail,
            customerName,
            group.map(d => ({ name: d.order.name, incomplete: d.labels })),
            Math.max(...group.map(d => d.number))
          );
      } catch (sendErr) {
        console.error(`Reminder send failed for ${first.customerEmail} (orders ${group.map(d => d.order.id).join(', ')}):`, sendErr);
        results.errors += group.length;
        return;
      }
      const combinedNote = group.length > 1
        ? ` One email covered ${group.length} orders: ${group.map(d => d.order.name).join('; ')}.`
        : '';

      for (const { order, labels, number: reminderNumber } of group) {
        const incompleteTabs = labels.map(label => ({ label }));
        // Log this reminder so we don't send it again. This write is split into
        // its OWN try/catch, separate from the send above (same pattern already
        // used for the send/dedupe-write pair in pages/api/aftership/webhook.js's
        // freight-notify path) — previously both awaits shared the one catch
        // block below, so a marker-write failure AFTER a successful send was
        // indistinguishable from a send failure: both just did
        // console.error + results.errors++. That's the wrong outcome for a
        // marker-write failure specifically, because the send already went out —
        // the next scheduled run would find no "[PORTAL: Reminder #N]" marker on
        // this order and re-send the IDENTICAL reminder email. A send failure
        // still falls through to the outer catch below (results.errors++, no
        // reminded++), which is correct: nothing went out, so the next run
        // should retry sending. A marker-write failure after a successful send
        // is a different, quieter failure mode that a customer will never see
        // but that needs a human to fix by hand, so it goes to
        // reportCriticalFailure() instead of a log line nobody is watching.
        try {
          await postTaggedUpdate(
            order.id,
            `PORTAL: Reminder #${reminderNumber}`,
            `Reminder #${reminderNumber} sent to ${order.customerEmail} on ${now.toLocaleDateString()}. Incomplete: ${incompleteTabs.map(t => t.label).join(', ')}.${combinedNote}${sent?.id ? ` Email ID: ${sent.id}` : ''}`
          );
        } catch (markerErr) {
          await reportCriticalFailure(
            'cron/reminders',
            `Reminder #${reminderNumber} was successfully emailed to ${order.customerEmail} (order ${order.id}, "${order.name}") but the "[PORTAL: Reminder #${reminderNumber}]" marker update failed to write afterward — the next scheduled run will NOT see this reminder as sent and WILL RE-SEND an identical reminder email to this customer. Add the marker manually in Monday.com (an update on the order reading "PORTAL: Reminder #${reminderNumber}") to prevent the duplicate send, or investigate the write failure below.`,
            { orderId: order.id, orderName: order.name, customerEmail: order.customerEmail, reminderNumber, error: markerErr.message }
          );
        }

        results.reminded++;
      }
    });

    // One staff email per run for every order that ran out of reminders,
    // then a marker on each so it's reported once per invite cycle. If the
    // email fails, no markers are written and the next run tries again.
    if (exhaustedOrders.length) {
      try {
        await notifyTeamRemindersExhausted(exhaustedOrders);
        await mapWithConcurrency(exhaustedOrders, REMINDER_CONCURRENCY, async (o) => {
          try {
            await postTaggedUpdate(o.id, EXHAUSTED_LABEL, `All ${MAX_REMINDERS} setup reminders have been sent to ${o.customerEmail} and setup is still incomplete (${o.incomplete.join(', ')}). Staff were emailed on ${now.toLocaleDateString()}. Re-send the portal invitation to restart reminders.`);
            results.exhausted++;
          } catch (err) {
            console.error(`Reminders-exhausted marker failed for order ${o.id} — staff may be re-notified next run:`, err.message);
          }
        });
      } catch (err) {
        console.error('Reminders-exhausted staff email failed:', err);
        results.errors++;
      }
    }

    // PORTAL-022: this summary previously only went out in the HTTP response
    // body, which nothing reads for a Vercel Cron invocation — a partial run
    // (see PORTAL-021: any hung/failed outbound call mid-loop lands in
    // results.errors, not a full stop) was only discoverable by comparing
    // expected vs. actual outcomes in Monday, with no log line to grep for.
    // Logging it explicitly makes every run's outcome visible in Vercel's
    // function logs regardless of whether anyone is watching the response.
    console.log(`Cron reminders summary: checked=${results.checked} reminded=${results.reminded} skipped=${results.skipped} exhausted=${results.exhausted} errors=${results.errors}`);

    // The run itself completing normally (reaching this line) previously
    // meant "no alert" even when every single order attempted failed — each
    // per-order failure is caught inside the mapWithConcurrency loop above,
    // so a systemic cause (e.g. RESEND_API_KEY revoked, a MONDAY_COL_* env
    // var renamed) never threw past that catch and never reached the outer
    // try/catch's reportCriticalFailure below. Alert explicitly when nothing
    // attempted actually succeeded, so a "quiet day" (skipped>0, errors=0)
    // stays silent but a broken run doesn't.
    const attempted = results.reminded + results.errors;
    if (attempted > 0 && results.reminded === 0) {
      await reportCriticalFailure(
        'cron/reminders',
        `Reminder cron completed but every attempted reminder failed (attempted=${attempted}, errors=${results.errors}). Likely a systemic issue (revoked/misconfigured RESEND_API_KEY, a renamed Monday column, etc.) rather than isolated per-order failures — check Vercel function logs for the specific errors.`,
        { ...results }
      );
    }

    return res.status(200).json({ ok: true, intervalDays: INTERVAL_DAYS, maxReminders: MAX_REMINDERS, ...results });
  } catch (err) {
    console.error(`Cron reminders FAILED before completing (checked=${results.checked} reminded=${results.reminded} skipped=${results.skipped} errors=${results.errors}):`, err);
    // PORTAL-023: a cron run that doesn't complete is exactly the silent-failure
    // scenario the finding flagged — nobody watches Vercel's function logs in
    // real time, so a broken run could go unnoticed for days. Alert a human.
    await reportCriticalFailure(
      'cron/reminders',
      `Reminder cron run failed before completing (checked=${results.checked} reminded=${results.reminded} skipped=${results.skipped} errors=${results.errors}).`,
      { error: err.message }
    );
    return res.status(500).json({ error: 'Cron job failed.', ...results });
  }
}
