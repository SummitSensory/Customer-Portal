# Email Template Management System — archived (PORTAL-025)

## What this is

This is the in-progress "Email Template Management System" that was started
on 2026-08-13: a separate Postgres-backed subsystem (via Prisma) intended to
let staff build, version, test-send, and audit-log customer email templates
from a visual block editor, with its own staff permission model — entirely
separate from Monday.com, which remains the system of record for orders and
customers.

It was flagged in the 2026-08-18 Deep Technical Audit (finding PORTAL-025) as
dead code: the database was never provisioned (`DATABASE_URL` was unset in
every environment), there was no UI wired up to call any of it, and nothing
in `pages/**` imported any of these files. Confirmed via repo-wide grep
(`email-templates|lib/permissions|@prisma/client|PrismaClient`) before this
archive was created — zero references outside this subsystem's own files.

## Why archive instead of delete

This represents real, substantial unfinished design work (see the original
design doc, `Email-Template-System-Design.md`, still at the repo root) — not
a mistake to be erased. Archiving it here, out of the actively-deployed
`lib/`/`pages/`/`prisma/` tree, gets the practical benefit the audit finding
asked for (dead code isn't shipped, isn't confusing to a future reader, and
doesn't force a Postgres/Prisma dependency the app doesn't otherwise need)
while preserving every line of it if you decide to finish the feature later.

## What moved here

- `prisma/schema.prisma` — the full data model (EmailTemplate, EmailVersion,
  EmailComponent, TestSend, AuditLog, StaffPermission, etc.)
- `lib/email-templates/blocks.js` — the visual block-editor component
  definitions
- `lib/email-templates/db.js` — Prisma client singleton + query helpers
- `lib/email-templates/render.js` — template → HTML render pipeline
- `lib/email-templates/sanitize.js` — input sanitization for user-authored
  template content
- `lib/email-templates/triggers.js` — event-trigger mapping (which portal
  events should fire which template)
- `lib/permissions.js` — staff role/permission checks scoped to this system

## What was changed in the active app as part of this archive

- `package.json`: removed the `prisma` and `@prisma/client` dependencies
  (nothing in the deployed tree uses them anymore) and regenerated
  `pnpm-lock.yaml` to match.
- `.env.example`: removed the `DATABASE_URL` placeholder from the active
  config section (it documented a database that was never provisioned).

No other files changed. Nothing in `pages/**` or the rest of `lib/**`
referenced any file in this archive, so nothing else needed to change for
the build to keep working — verified with a full `next build` after this
move.

## How to resume this work later

1. Move all of the files above back to their original paths (`prisma/`,
   `lib/email-templates/`, `lib/permissions.js`).
2. Re-add `"prisma"` and `"@prisma/client"` to `package.json` (pin to a
   current version at the time you resume — don't assume `5.18.0` is still
   current) and run `pnpm install`.
3. Provision the Postgres database (Vercel dashboard → Storage → Create
   Database → Postgres) and set `DATABASE_URL` in your environment.
4. Run `npx prisma generate` and `npx prisma migrate deploy` (or `db push`
   for a first-time setup) against the schema in `prisma/schema.prisma`.
5. Build the UI that was never built: an admin page to author/version
   templates using the blocks in `blocks.js`, wired through `render.js` and
   `triggers.js`, gated by `lib/permissions.js`.
6. Re-run the audit's PORTAL-025 finding logic (grep for these paths from
   `pages/**`) to confirm the new UI is actually wired up before considering
   the feature "shipped" — the whole point of this archive was that
   unwired backend code is invisible dead weight, not a working feature.
