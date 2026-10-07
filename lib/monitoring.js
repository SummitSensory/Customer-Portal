/**
 * PORTAL-023: lightweight, no-new-account-required error monitoring.
 *
 * A real APM (Sentry, Datadog, etc.) needs an account/DSN only Bryan can
 * create — not something to fabricate with placeholder credentials. This
 * gives the practical outcome the finding actually asked for ("nobody is
 * proactively notified when a critical failure happens") using
 * infrastructure already live in this app (structured console logs +
 * Resend email), reserved for the small set of failure points that were
 * explicitly flagged elsewhere in the audit as needing to "log loudly":
 *   - markSectionComplete failing even after a retry (PORTAL-014)
 *   - a cron job's run not completing at all (PORTAL-021/022)
 *
 * Deliberately NOT wired into routine security rejections (bad webhook
 * secret, invalid session, etc.) — those are expected/frequent enough that
 * emailing on every one would just train everyone to ignore the alerts.
 *
 * If real APM is set up later, this is the one place to redirect from.
 */
import { sendInternalAlert } from './email';

// AUDIT-2026-10-06: lib/errorAlerts.js emails every console.error as an
// URGENT error, so the log line below used to produce a second email for
// every team alert. errorAlerts skips lines starting with ALERT_LOG_PREFIX.
// The "failed to send the alert email itself" line deliberately uses a
// different prefix: if the team alert didn't go out, the urgent error email
// is the only notice anyone gets.
export const ALERT_LOG_PREFIX = '[ALERT:';

export async function reportCriticalFailure(source, message, details = {}) {
  // Always log first — this must never be the only thing that fails.
  console.error(`${ALERT_LOG_PREFIX}${source}] ${message}`, details);
  try {
    await sendInternalAlert(source, message, details);
  } catch (err) {
    console.error(`[ALERT-SEND-FAILED:${source}] failed to send the alert email itself:`, err.message);
  }
}
