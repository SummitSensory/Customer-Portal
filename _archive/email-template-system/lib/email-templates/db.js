/**
 * Prisma client singleton for the email template database — a SEPARATE
 * Postgres database from Monday.com, scoped only to template content,
 * versions, components, test sends, audit log, and staff permissions.
 * Monday remains the system of record for orders/customers; nothing here
 * touches that data.
 *
 * DATABASE_URL is not provisioned yet as of this commit (2026-08-13) — see
 * Email-Template-System-Design.md §B.2 and the "Open decisions" list. Once
 * Bryan creates a Postgres database from the Vercel dashboard (Storage →
 * Create Database) and links it to this project, Vercel injects the
 * connection string automatically and this file starts working with no
 * further code change needed.
 *
 * The `require()` below is deliberately lazy (not a top-level import) so this
 * module can be safely imported before `prisma generate` has ever been run in
 * a given environment, without crashing the whole app at import time.
 */

let _prisma = null;

export function getPrisma() {
  if (_prisma) return _prisma;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not configured — the email template database has not been provisioned yet. ' +
      'See Email-Template-System-Design.md §B.2 for setup steps.'
    );
  }

  // eslint-disable-next-line global-require
  const { PrismaClient } = require('@prisma/client');
  _prisma = new PrismaClient();
  return _prisma;
}
