> **Addendum (same day, after the mockup was sent):** the `monday-flow.html` mockup's Section 03 caption promises that \"Color Forms Received\" fills in automatically when a staff member flips a row to Received on GB/R/Accessories — not just from portal submissions. That's a real webhook mechanism, not hand-waving, and it's confirmed buildable below.

# Color Selection Completion Tracking — Findings & Design Options (2026-08-22)

Bryan asked for a way for manufacturing to know when *every* color selection form a multi-product order needs has actually come in (e.g. Ball Pit + Ball Pit Balls + Adventure Series = 3 required inputs), with explicit instructions not to guess at code, not to assume anything is already built, and not to assume the current process is understood.

## What was verified directly against the live Monday account (not assumed)

Two separate, disconnected systems already touch "color selection":

1. **Portal Jotform forms** (7–8 per-product Jotforms embedded in the customer portal) → webhook.js records submissions as tagged updates on the Manufacturing Process order. The webhook **already has** a proven "don't mark complete until every mapped form for this tab has submitted" check (`formsForTab`, documented in the 2026-08-17 audit, PLAN-12/PORTAL) — but it only knows about forms wired into `JOTFORM_FORM_MAP`, and has no visibility into the boards below.
2. **Two staff-facing Monday-native boards**, already live and in active use:
   - **ALL PRODUCTS – Color Selection (GB)** (board 8097394746, 159 items) — structural/frame paint colors (legs, beams, ladder, slide, slide platform, climbing wall, Soar frame, Flex frame), one row per order.
   - **ALL PRODUCTS – Color Selection (R)** (board 8047969422, 167 items) — mat/pad color + which frame series it belongs to. Real color palette confirmed (Black, Charcoal, Navy, Red, Kelly Green, etc.)
   - Both use item-name = organization name, and a board-relation column linking to Manufacturing Process (6533700776), matched by org name — the exact convention Bryan asked to be applied to the new pilot board.
   - An older, mostly-retired **ARCHIEVED – Color Selection (GB)** board (6885107765) shows the legacy request→received manual workflow (email button, file uploads, signature capture).

**Confirmed gaps:**
- Neither GB nor R tracks Ball Pit / Ball Pit Balls colors at all — no column or row type exists anywhere in Monday for either product.
- Sampling live GB items found one (of six sampled) with an **empty board-relation** ("Soar Autism Center - South Colorado Springs") — concrete evidence the manual org-name-matching link is not 100% reliable today.
- Manufacturing Process (135 columns, checked in full) has **no rollup field** answering "how many color inputs does this order need vs. how many are in."
- Monday's "progress"/Battery column type was checked directly (`get_column_type_info`) and does **not** roll up connected-board items — it only weights status columns on the same item. Ruled out as a native cross-board rollup mechanism.

## Pilot board changes made (Portal Color Selection — Pilot, board 18427680330)

- Renamed sample item so org name is the item name (matches GB/R convention).
- Added "link to Manufacturing Process" board-relation column (same config as GB/R).
- Added "Entry Status" status column (Added to Board / –).
- Deliberately did NOT link the sample item to any real Manufacturing order (fake data), and made no changes to the live Manufacturing Process board — that depends on which design option is chosen.

## Design options presented (full detail in delivered docx)

1. **Order-Level Checklist, code-owned truth** — Required/Received multi-selects on Manufacturing Process, computed by extending the existing webhook.js pattern. High reliability, needs real backend work.
2. **Consolidated "Color Fulfillment" hub board** — one row per (order × product), retires GB/R fragmentation. Medium reliability (no native Monday rollup exists — verified), moderate migration cost.
3. **Third satellite board (Accessories), fully manual** — matches GB/R pattern for Ball Pit/Ball Pit Balls, zero new code, but inherits the same manual-linking fragility already observed.
4. **Hybrid (recommended)** — keep GB/R as-is, add Accessories board in the same pattern, but layer the Required/Received/Ready-for-Production trio on top, computed by code across all four sources (GB, R, Accessories, portal Jotform). Staged rollout: Stage 1 Monday-config only, Stage 2 small reviewed backend change (extends existing proven pattern), Stage 3 the "Ready for Production" signal once Stage 2 is proven against real orders.

## Explicitly not done yet (pending Bryan's choice of option)

- No changes to live Manufacturing Process board schema.
- No new backend/webhook code written or shipped.
- No Ball Pit / Ball Pit Balls Jotform built (per "duplicate, don't modify existing forms" instruction).
- Pilot board's new columns not wired to anything live.

## Open questions sent to Bryan

Which option (1–4)? OK to build the Accessories board once real Ball Pit/Ball Pit Balls colors are provided? Where should the "Ready for Production" signal live day-to-day?

Full analysis with tables delivered as `Color-Selection-Completion-Tracking.docx`.

## Webhook feasibility check on the mockup's "staff flips Received" mechanism (2026-08-22, post-mockup)

The `monday-flow.html` mockup (Section 03 caption) claims a staff member manually changing a status on a GB/R/Accessories row can flip the order's "Color Forms Received" checklist automatically, same as a portal submission does. Checked this against the real, deployed code rather than assuming it — specifically against `pages/api/monday/accessory-webhook.js`, the one place in the codebase that already does "Monday column change → webhook → write-back" (it currently powers freight-status lookups when staff enter Carrier Code/Freight Tracking ID on a Therapy Equipment & Accessories **subitem**).

**Verified: fully buildable, and actually the easy case.**

- GB (#8097394746) and R (#8047969422) are flat boards — one top-level item per order, not subitems. A Monday "when column changes" automation pointed at a "Received" status column on these boards is the exact same mechanism already proven live by `accessory-webhook.js` (`change_column_value` event → `event.pulseId`/`event.columnId` → lookup → write-back) and by `update-webhook.js` ("when an update is created"). No new technique is required — it's a second registration of a pattern already in production, generalizing the `TRIGGER_COLUMNS` set idea to a "Received" column and pointing the write-back at the Manufacturing Process order's checklist instead of AfterShip.
- The new Accessories board (Ball Pit / Ball Pit Balls) is proposed in the same flat, one-row-per-order convention as GB/R (per the design options above) — not as subitems of Manufacturing Process. So it's the same trivial case a third time, not a harder one.
- The only place this codebase's subitem-level webhook actually applies is the *unrelated* freight-tracking feature, where the trigger fires on a Therapy Equipment & Accessories **subitem** column change. Even there it already works in production — Monday's visual "automation recipe" builder on the *parent* board doesn't expose subitem columns as a trigger option, but registering the automation directly on the subitem's own underlying board ID (which Monday auto-creates whenever a board has subitems) works fine and is exactly what's live today. So even in the harder, subitem-based case, this is a known, already-solved workaround — not an open risk.

**Bottom line:** nothing about the mockup's dual-direction "Received" mechanism (portal submission OR staff manually flipping GB/R/Accessories) requires new Monday capability or an unproven pattern. It's Stage 2 of Option 4 exactly as scoped — extend the existing webhook pattern to watch GB/R's (and the new Accessories board's) "Received" column in addition to Carrier Code/Freight Tracking ID, and write the result to the same Required/Received checklist fields on Manufacturing Process. No subitem workaround is even needed since none of the three boards involved use subitems.
