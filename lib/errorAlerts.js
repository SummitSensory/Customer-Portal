/**
 * Emails every portal error to Bryan, flagged urgent (requested 2026-10-05).
 *
 * Three ways an error gets here:
 *   - any console.error on the server (installConsoleCapture, wired up in
 *     instrumentation.js), which covers the ~90 catch blocks across
 *     pages/api that log and return a 500
 *   - unhandled request errors Next.js reports via onRequestError
 *     (instrumentation.js)
 *   - browser errors posted to /api/client-error by pages/_app.js
 *
 * This is broader on purpose than lib/monitoring.js, which stays narrow and
 * emails the team. Three guards keep a single outage from flooding the inbox:
 *   - one email per distinct error per DEDUPE_WINDOW_MS (the next email for
 *     that error says how many repeats were skipped)
 *   - at most MAX_EMAILS_PER_HOUR in total
 *   - production only (VERCEL_ENV === 'production'), so Preview/staging and
 *     local dev don't email
 * The limits are per serverless instance (in memory, same tradeoff as
 * lib/rateLimit.js), so a busy outage can still send a few more than that.
 */
import { inspect } from 'util';
import { waitUntil } from '@vercel/functions';
import { sendUrgentErrorAlert } from './email';

const DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const MAX_EMAILS_PER_HOUR = 30;
// AUDIT-2026-10-06: browser errors arrive through an unauthenticated endpoint
// (/api/client-error). They used to share the hourly cap above, so a flood of
// junk "browser errors" could use up the cap and silence real server errors
// for the rest of the hour. Each budget now has its own cap and its own
// dedupe keys (a client can't pre-empt a server error's dedupe slot either).
const MAX_EMAILS_PER_HOUR_BY_BUDGET = { server: MAX_EMAILS_PER_HOUR, client: 10 };

// Lines lib/monitoring.js's reportCriticalFailure logs — that already emails
// the team, so emailing it again here as an URGENT error was a duplicate.
const ALREADY_ALERTED_PREFIX = '[ALERT:';
const RECENT_LOG_LINES = 40;
const MAX_LINE_CHARS = 1000;

const recentLog = [];
const lastSentByKey = new Map(); // key -> { at, suppressed }
const sentTimestampsByBudget = new Map(); // budget -> [timestamps]

// Captured before installConsoleCapture patches anything, so failures inside
// this module never re-enter it. (If something deeper, e.g. the Resend SDK,
// logs its own console.error, the dedupe window and hourly cap stop a loop.)
const rawConsoleError = console.error.bind(console);

function enabled() {
  return process.env.VERCEL_ENV === 'production' || process.env.ERROR_ALERTS_FORCE === 'true';
}

function formatArg(arg) {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  return inspect(arg, { depth: 4, breakLength: 120 });
}

function remember(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args.map(formatArg).join(' ')}`;
  recentLog.push(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
  if (recentLog.length > RECENT_LOG_LINES) recentLog.shift();
}

// Digits/ids stripped so "order 123 failed" and "order 456 failed" count as
// the same error for dedupe purposes.
function dedupeKey(message) {
  return String(message).split('\n')[0].replace(/\d+/g, '#').slice(0, 300);
}

/**
 * Email one error to Bryan (subject to the guards above). Never throws.
 * Returns the send promise, which is also handed to waitUntil so the
 * serverless function stays alive until the email goes out.
 */
export function reportError({ source, error, message, stack, context = {}, budget = 'server' }) {
  try {
    if (!enabled()) return Promise.resolve();

    const msg = message || (error instanceof Error ? `${error.name}: ${error.message}` : formatArg(error));
    const trace = stack || (error instanceof Error ? error.stack : undefined);

    const now = Date.now();
    const budgetName = Object.prototype.hasOwnProperty.call(MAX_EMAILS_PER_HOUR_BY_BUDGET, budget) ? budget : 'server';
    const key = `${budgetName}:${dedupeKey(msg)}`;
    const prior = lastSentByKey.get(key);
    if (prior && now - prior.at < DEDUPE_WINDOW_MS) {
      prior.suppressed++;
      return Promise.resolve();
    }
    const sentTimestamps = (sentTimestampsByBudget.get(budgetName) || []).filter(t => now - t < 60 * 60 * 1000);
    sentTimestampsByBudget.set(budgetName, sentTimestamps);
    if (sentTimestamps.length >= MAX_EMAILS_PER_HOUR_BY_BUDGET[budgetName]) return Promise.resolve();

    const suppressed = prior?.suppressed || 0;
    lastSentByKey.set(key, { at: now, suppressed: 0 });
    sentTimestamps.push(now);
    if (lastSentByKey.size > 500) lastSentByKey.delete(lastSentByKey.keys().next().value);

    const fullContext = {
      ...context,
      environment: process.env.VERCEL_ENV,
      deployment: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA,
      region: process.env.VERCEL_REGION,
      ...(suppressed ? { repeatsSinceLastEmail: `${suppressed} more of this error were not emailed (15-minute dedupe)` } : {}),
    };

    const promise = sendUrgentErrorAlert({
      source,
      message: msg,
      stack: trace,
      context: fullContext,
      recentLog: [...recentLog],
    })
      .catch(err => rawConsoleError('[error-alert] failed to email error alert:', err.message));
    try { waitUntil(promise); } catch { /* outside a request — the promise still runs */ }
    return promise;
  } catch (err) {
    rawConsoleError('[error-alert] reportError itself failed:', err?.message);
    return Promise.resolve();
  }
}

/**
 * Patch console.* once per server instance: every line goes into the recent
 * log buffer, and console.error also triggers reportError. Node runtime only.
 */
export function installConsoleCapture() {
  const flag = Symbol.for('summit.errorAlerts.installed');
  if (globalThis[flag]) return;
  globalThis[flag] = true;

  for (const level of ['log', 'info', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try { remember(level, args); } catch { /* never break logging */ }
      original(...args);
    };
  }

  console.error = (...args) => {
    rawConsoleError(...args);
    try {
      remember('error', args);
      if (typeof args[0] === 'string' && args[0].startsWith('[error-alert]')) return;
      if (typeof args[0] === 'string' && args[0].startsWith(ALREADY_ALERTED_PREFIX)) return;
      // Node's own process warnings (ExperimentalWarning, DeprecationWarning…)
      // print through console.error as "(node:4) SomeWarning: …" on every cold
      // start. Not portal errors — kept in the recent log, never emailed.
      if (typeof args[0] === 'string' && /^\(node:\d+\) (\[\w+\] )?\w*Warning:/.test(args[0])) return;
      const err = args.find(a => a instanceof Error);
      reportError({
        source: 'server console.error',
        message: args.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : formatArg(a))).join(' '),
        // The Error's own stack if one was logged; otherwise where console.error was called.
        stack: err?.stack || new Error('console.error call site').stack.split('\n').slice(2).join('\n'),
      });
    } catch { /* never break logging */ }
  };
}
