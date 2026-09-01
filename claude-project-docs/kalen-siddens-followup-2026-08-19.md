# Customer Portal — Kalen Siddens Follow-Up (2026-08-19 → 2026-08-20)

Continuation of the 2026-08-17 audit (`kalen-siddens-portal-audit-2026-08-17.md`). Full detail for everything below lives in `Customer-Portal-Process-Flow.md` (PLAN-20, PLAN-21, PLAN-22) on Bryan's device; this doc is a shorter project-side pointer to what happened and why.

## 1. Delivery + billing snapshot backfill (PLAN-20)

Bryan reported (screenshot) that Kalen's already-submitted Delivery answers still weren't visible in the portal despite showing correctly on Monday's Delivery & Site Details Submissions board. Root cause: the 2026-08-17 fix that added `deliverySnapshot`/`billingSnapshot` columns only captures data going forward from that date — Kalen submitted four days earlier, so his answers never landed in the column the portal reads.

Bounded a "same class of gap" audit via grep (`JSON.parse|Snapshot` in `lib/monday.js`) — confirmed exactly two such forward-only snapshots exist in the whole codebase, both from the same 2026-08-17 fix. Backfilled both, with Bryan's explicit go-ahead on each:

- **Delivery** — 5 affected orders (Kalen Siddens, Remedy Speech Therapy, Stepping Stone Pediatric Therapy, Action for Autism, an internal Sensory Club of Denver relocation order), reconstructed field-for-field from the Submissions board's `orderItemId` foreign key.
- **Billing** — 6 affected orders (the same 5 plus Preparing Individuals Today for Tomorrow, LLC), contact fields only, reconstructed from the fixed-format `[PORTAL: Billing Information]` tagged update. Decomposed address fields deliberately left blank — not reliably reconstructable from a comma-joined free-text string, and `BillingTab` already treats the combined address as read-only reference text by design.

No code changed — one-time production data fixes.

## 2. Admin-visible delivery submissions + item-name cleanup (PLAN-21)

Bryan then raised three related asks from screenshots of the Submissions board's Main table (mostly blank rows for orders that haven't submitted yet):

- **How does a submission connect back to a customer?** Two mechanisms: the customer's session cookie is bound to a specific `order.id` (`/api/auth/select-order.js`, re-derived server-side, never trusted from the client), and separately every Submissions-board item carries `orderItemId = String(order.id)` as a real foreign key (`text_mm571ym4`) plus a back-link to the order's Monday pulse.
- **Item names had a date baked in** ("Kalen Siddens — 8/13/2026") — Bryan: "there is no reason to have the date added into the customer name." Fixed in `lib/monday.js`'s `createDeliverySubmissionItem()`: name is now just `order.name`. Safe to drop — the board already has a separate `submittedDate` column and the `orderItemId` FK, so nothing depended on the date for uniqueness.
- **Seeing completed submissions without opening the Monday board.** Evaluated the options (Monday-side view/filter vs. a new admin page vs. surfacing it in the existing Admin Orders table) and built directly, per Bryan's request to make the call rather than hand it back: added a "🚚 Delivery" toggle on each order row in `pages/admin/index.js`, expanding a read-only panel sourced from `order.deliverySnapshot` — already loaded on every order, so this needed no new Monday structure or API calls. The button only appears on orders that actually have a submission, so the blank-row scanning problem disappears rather than moving to a new screen.

Verified with a full `next build` (zero errors); delivered to the device.

## 3. Unread-messages badge miscounted the whole audit trail (PLAN-22)

Bryan reported (screenshot) Rachel's (Remedy Speech Therapy) Messages tab showing a "15" unread badge with only 1 message visible in the thread, that 1 message also mislabeled as sent by "Summit Sensory Gym." Pulled the order's real Monday update history: 17 total updates, only 1 a genuine chat post — the other 16 are this app's own internal audit tags (contact-update requests, staff-viewing-as-customer sessions, delivery/billing confirmations, reminders, invitation-sent logs). `getOrderMessages()` returns the entire update history, and the badge counted `isStaffMessage()` over that raw list instead of filtering to real chat first — every audit tag inflated the count since all of them share the same "attributed to the API token owner" quirk real staff chat has. **Fixed:** added a shared `isPortalChatMessage()` helper to `lib/messageOrigin.js` (isolates the literal `[PORTAL]` chat tag from every other `[PORTAL: ...]` audit tag) and required it before counting; the Messages tab's own display filter now uses the same helper so the two can't drift apart.

**Not fixed, and not fixable retroactively:** the one real message displaying as "Summit Sensory Gym" instead of Rachel. It was sent in the narrow window on 2026-08-17 before PLAN-12 fix (5)'s origin-tagging went live, so it carries no origin tag at all — `isStaffMessage()`'s only option for untagged history is a creator-email guess, which is always "staff" (Monday attributes every update to the API token owner). Already documented as an unrecoverable gap in PLAN-12/16; only affects messages sent in that specific pre-fix window.

## Still open

- **Jotform Color Selection prefill** — Bryan's own "next project," explicitly deprioritized; not started. (Superseded on 2026-08-22 by the much larger native-picker redesign — see `color-selection-redesign-proposal-2026-08-22.md`.)
- **"Goldberg Brothers" tool** — a screenshot asked whether Kalen Siddens should appear in that tool's "Saved addresses" dropdown. Confirmed it's not part of this codebase (no references anywhere in the repo) — waiting on Bryan to say what that tool actually is before anything can be diagnosed.
