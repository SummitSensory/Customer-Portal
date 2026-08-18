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

export async function reportCriticalFailure(source, message, details = {}) {
  // Always log first — this must never be the only thing that fails.
  console.error(`[ALERT:${source}] ${message}`, details);
  try {
    await sendInternalAlert(source, message, details);
  } catch (err) {
    console.error(`[ALERT:${source}] failed to send the alert email itself:`, err.message);
  }
}
