# Customer Portal — "Build and Fix" Session (2026-08-27, afternoon)

Continuation of the same-day fresh audit (`fresh-audit-and-fixes-2026-08-27.md`). Bryan's directive: "Build and fix as many of these issues as possible. I need the software to be ready when I tell you to go live and not have to wonder if something is connected or working correctly."

## 1. FIXED & VERIFIED — `formsForTab` productTypes bug

**File:** `pages/api/jotform/webhook.js`.

**Bug:** With 3 live productType-scoped Color Selection Jotform forms (Adventure Series / Soar / Flex), the webhook's multi-form completeness check (`formsForTab`) required ALL 3 forms to be submitted before flipping "Portal: Color Selections" to done — but a single order can only ever submit the ONE form matching its own product type. Result: automatic Color-tab completion via Jotform submission was silently broken for every order; only the manual "Mark Complete" button was making it appear to work.

**Fix:** `formsForTab(formMap, tabType, productType)` now takes the order's product type and filters to only the forms that actually apply to it — mirrors the frontend's existing `productForms` filter in `pages/portal/index.js` exactly (`!f.productTypes || f.productTypes.includes(productType)`). Call site updated to pass `order.productType`. Deployed to production 8/27.

## 2. FIXED & VERIFIED — live Monday.com Prismatic Upcharge formula bug, real money affected

Not a codebase issue — a live Monday.com formula/label mismatch on the **ALL PRODUCTS - Color Selection (GB)** board (8097394746). The "Prismatic Upcharge" formula (`formula_mkv1at57`) only recognized the label `"Prismatic (+$350.00)"`, used by just 2 of 7 paint-brand columns (Soar Frame, Flex Frame). The other 5 columns (Legs, Horizontal Beams, Ladder Rungs & Ladder Leg, Slide Platform, Climbing Wall) use `"Prismatic (Additional Cost)"` for the same option, so the formula silently showed $0.00 for those. It was also a flat boolean that could never charge more than one flat amount no matter how many parts were Prismatic.

Real pricing (per Bryan): $500 for the 1st Prismatic color, $300 for each additional. Re-verified against all 167 live board items: **28 real orders** had at least one Prismatic selection; correct total **$26,000**; the broken formula had only captured **$1,050** — a **$24,950** gap.

**Fix applied and verified 2026-08-31.** New formula counts Prismatic selections across all 7 columns (recognizing both labels) and prices at $500 + $300 × (count − 1). Applied via `update_column` to `formula_mkv1at57`. Re-checked all 167 items post-change — every value matches the predicted correct amount exactly. **Per Bryan's explicit instruction, the $24,950 historical gap was NOT invoiced retroactively** — fixed going forward only. This item is fully closed.

## 3. Confirmed (empirically) — per-product-line paint column mapping

Pulled all 160 GB board items to verify which of the 8 "part" columns apply to which product line, zero exceptions: Summit Adventure Series populates a subset of Legs/Horizontal Beams/Ladder Rungs & Ladder Leg/Slide Platform/Slide (Color)/Climbing Wall (never Soar or Flex Frame); Summit Soar populates only Soar Frame; Summit Flex populates only Flex Frame. Matches the 3-form `JOTFORM_FORM_MAP` split — real, board-verified ground truth for the future picker → GB write-path design.

## 4. NEW FINDING — the "obvious" order↔GB lookup path is unreliable; the safe direction is the other way

Manufacturing Process → GB board-relation was empty on 2 of 4 real orders checked, including a fully shipped, fully-colored order. GB → Manufacturing Process was populated on 4 of 4 checked. **Implication:** any future write-path backend must look up the GB/R item by scanning GB/R for the item whose own relation points to the order — not trust the Manufacturing-side reflection column. Same full-board-scan pattern already proven in production (`findOrderByFreightTracking`, `findAccessorySubitemByTracking` in `lib/monday.js`).

## 5. Not built yet this session, and why

The actual GB/R write-path backend and the real React picker UI were not built, because: the completion-tracking design (4 options from `color-selection-completion-tracking-2026-08-22.md`) is still undecided and the write-path's shape depends on it; building new interactive UI with no way to click through it was a real risk; the Prismatic formula bug was higher-value to resolve first. Recommended order once Bryan decides: (a) Prismatic fix [done], (b) completion-tracking design decision, (c) write-path backend using the safe GB/R-side-scan lookup, (d) UI work once there's real backend to test against.

## 6. Two more color-selection Jotform forms found built but never wired in — FIXED & DEPLOYED

Found two Jotform forms that existed but had zero references in `JOTFORM_FORM_MAP`: `260294642066155` (Interlocking Mats, scoped to "Therapy Mats & Pads") and `252664785765171` (Soar Column Wraps & Floor Padding, scoped to Summit Soar).

**Confirmed real bug (2026-08-31):** the order's `productType` is the raw, unmodified `.text` of Monday's "Product Series STD Column" (`color_mkvw7b8`) — exact array-membership matching, no normalization anywhere (`lib/monday.js`, `pages/portal/index.js`, `pages/api/jotform/webhook.js` all confirmed). Real live labels are the FULL strings: `"Summit Adventure Series: Custom Sensory Gym"`, `"Summit Soar: Mobile Free-Standing Swing Frame"`, `"Summit Flex: Universal Exercise Unit"` and `"Summit Flex: Universal Exercise Unit & Accessories"` (both active), `"Therapy Mats & Pads"`. The saved env var used short forms (`"Summit Adventure Series"`, `"Summit Soar"`, `"Summit Flex"`) — **4 of 5 productType-scoped forms never matched a single real order.** Only Therapy Mats & Pads worked, because that label has no suffix.

**Fixed and deployed 2026-08-31** (`dpl_2D7FPZNsd51vA8QfSxsmV6whjxxT`, confirmed READY, aliased to `portal.summitsensory.com`) with the corrected full-label `JOTFORM_FORM_MAP`:

```json
{"243444705854057":{"name":"Pickup & Delivery Form","description":"Confirms your pickup and delivery preferences","tab":"required_documents"},"243436740186156":{"name":"Color Selection","description":"Select your equipment colors","tab":"color_selection","productTypes":["Summit Adventure Series: Custom Sensory Gym"]},"243396895100057":{"name":"Color Selection","description":"Select your equipment colors","tab":"color_selection","productTypes":["Summit Soar: Mobile Free-Standing Swing Frame"]},"243426572564158":{"name":"Color Selection","description":"Select your equipment colors","tab":"color_selection","productTypes":["Summit Flex: Universal Exercise Unit","Summit Flex: Universal Exercise Unit & Accessories"]},"260294642066155":{"name":"Color Selection","description":"Select your mat and edging colors","tab":"color_selection","productTypes":["Therapy Mats & Pads"]},"252664785765171":{"name":"Color Selection","description":"Select your column wrap and floor padding colors","tab":"color_selection","productTypes":["Summit Soar: Mobile Free-Standing Swing Frame"]}}
```

This is the SAME root cause later confirmed to explain Remedy Speech Therapy's stuck Color Selection tab — see `build-and-fix-2026-08-27.md`'s own section 10 equivalent in the main project doc (also mirrored in this repo's own history — Remedy's product type, "Summit Adventure Series: Custom Sensory Gym," was one of the 4 broken labels, so her form never rendered before this fix went live).

## 7. Sandbox / staging branch — CONFIRMED WORKING

Bryan created a `staging` branch via GitHub Desktop. Vercel auto-generates a separate Preview deployment (its own URL, distinct from `portal.summitsensory.com`) whenever `staging` is pushed — confirmed end-to-end with a harmless test marker (`staging-preview-test` meta tag, still present in `pages/index.js`, safe to remove whenever convenient, low priority). **Use this for any future risky change:** edit → push to `staging` → get a private preview URL → click through it → merge to `main` only when satisfied — without ever touching production in between.

**Important limitation Claude cannot work around:** Claude (via the device bridge or Cowork) does not run git commands against this repo — file edits only. Bryan (or whoever has repo access) must review, commit, and push every change himself, on `staging` first if he wants a look before production.

## 8. Preview-environment credential decision — resolved 2026-08-31

Bryan confirmed: yes, isolate Preview from Production credentials.

| Variable(s) | Touches | Call |
|---|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM`, `NOTIFY_TEAM_EMAIL` | Order emails to customers | **Do it** — 2nd Resend API key, point Preview's from/notify at Bryan's own inbox |
| `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER` | Shipment tracking | **Do it** — FedEx Developer Portal free sandbox credentials |
| `MONDAY_API_TOKEN` | Real orders, colors, invoicing | **Skip for now** — no Monday sandbox exists; true isolation needs a second dummy Monday account, disproportionate effort right now |
| `AFTERSHIP_API_KEY`, `AFTERSHIP_WEBHOOK_SECRET` | Carrier tracking | **Skip for now** — no public sandbox exists |
| Internal secrets (`MONDAY_ACCESSORY_WEBHOOK_SECRET`, `MONDAY_UPDATE_WEBHOOK_SECRET`, `MONDAY_INVITE_SECRET`, `CRON_SECRET`, `NEXTAUTH_SECRET`, `JOTFORM_WEBHOOK_SECRET`) | Request verification only | Optional polish, generate fresh values whenever convenient |

## 9. URGENT (2026-09-01) — delivery address silently not saving on re-confirmation — FIXED, PENDING DEPLOY

Real customer complaint (Waunakee Community School District): entered a corrected delivery address 3 times, portal kept showing the original wrong one. Root cause confirmed against their real Monday activity log: `pages/api/portal/setup.js`'s Delivery tab handler only wrote the address to Monday's `long_text_mkpkdtj4` ("Confirmed Delivery Address") column when the customer answered "No, I need to update it" (`addressConfirmed === false`). But `shipToParts()` in `pages/portal/index.js` builds the formatted address from the **Billing Information tab's** address whenever `addressConfirmed !== false` — so a customer who fixes their address on Billing and then answers "Yes, this is correct" on Delivery submits a fully correct address that this handler silently discarded. Confirmed against Waunakee's real deliverySnapshot: 8/30 `addressConfirmed:false` with the wrong address (wrote correctly, still on file); 8/31 twice with `addressConfirmed:true` and the correct address in the snapshot (never wrote, because the gate required `false`).

**Fix:** removed the `addressConfirmed === false &&` gate in `pages/api/portal/setup.js` — the address now always writes when `formattedAddress` is present, since it's always populated one way or another. Edited on Bryan's local clone 2026-09-01, verified with `node --check`. **Not yet committed/pushed** (Claude does not run git — see section 7). Bryan pushed this to `staging` on 2026-09-01.

**Stopgap needed:** Waunakee's Monday record (item `12916477588`, board 6533700776) still shows the wrong address right now — the code fix only prevents this going forward. Bryan needs to manually correct `long_text_mkpkdtj4` to `905 Bethel Circle, Waunakee, WI 53597, United States` (exactly what the customer submitted, confirmed from her own deliverySnapshot — Claude attempted this directly and was blocked by an automatic safety check on writing customer data).

## 10. Remedy Speech Therapy — explained, not a new bug (2026-09-01)

Second customer complaint: stuck "Incomplete: Color & Product Selections, Required Documents" reminders despite saying she'd already done everything (item `12796259285`). Her product type is `Summit Adventure Series: Custom Sensory Gym` — one of the four labels broken by the productTypes bug (section 6 above). Her Monday activity log confirms the theory exactly: on 8/17 she messaged staff directly ("we made all color selections and paid the amount due") rather than submitting the real Jotform — there's no `[PORTAL: Color Selections]` tagged update anywhere in her history, and two staff members impersonated her account on 8/20 trying to help and evidently still couldn't get a submission through, consistent with the form not rendering at the time. Her Color Selection form should work now that the fix is live.

**Required Documents is a separate, genuine gap** — that form (`243444705854057`) has no `productTypes` restriction, was never affected by the bug, and there's no submission anywhere in her history. Needs a direct follow-up with the customer, not a system fix.
