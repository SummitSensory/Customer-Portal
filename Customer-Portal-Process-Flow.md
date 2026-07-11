# Summit Sensory Gym — Customer Portal Process Flow & System Reference

**Version 1.0 — July 2026**
**Purpose:** A single source-of-truth reference for how the Customer Portal works end to end, from the moment a customer signs the proposal to the moment they receive delivery. Every step names the exact system and data source (Monday board + column ID, API endpoint, external service, or email) so this file can be re-uploaded to Claude to request precise changes.

---

## 0. How to use this document (read me first)

This document is written so you can upload it back into Claude and say things like:

- *"Add a new step after **S-4.3** that…"*
- *"Change the data source for **DS-12** from column X to column Y…"*
- *"Delete email **EM-07** and replace it with…"*
- *"The **Therapy Mats & Padding** shipment (see **SHP-2**) should now pull from a subitem instead of a column."*

Every stage, data source, endpoint, email, and screen has a **stable reference code** (e.g. `S-3.2`, `DS-05`, `EP-11`, `EM-04`, `SCR-2`). When you want something added, changed, or deleted, cite the code and describe the change. Claude will use the codes to locate the exact place in the code and this document.

**Source of truth for IDs:** the live column IDs come from `lib/monday.js` (the `COLS` map). If `SETUP.md` and `lib/monday.js` ever disagree, `lib/monday.js` wins.

**Legend for status of each item:**
`[LIVE]` = built and running · `[PARTIAL]` = built but not fully wired/configured · `[PLANNED]` = agreed but not yet built.

---

## 1. System architecture (the moving parts)

| Ref | System | Role | Where it lives |
|---|---|---|---|
| SYS-1 | **Next.js web app** (React) | The portal itself — customer UI + admin UI | Hosted on Vercel; code in `/pages`, `/lib` |
| SYS-2 | **Monday.com** | System of record for orders, status, files, tracking | Board: **Manufacturing Process**, Board ID `6533700776` |
| SYS-3 | **Jotform** | Color/product selection + document collection forms | Webhook → SYS-1 |
| SYS-4 | **FedEx Track API** | Live parcel/freight tracking status | Called by SYS-1 (`lib/fedex.js`) |
| SYS-5 | **Resend** | All transactional email | Called by SYS-1 (`lib/email.js`) |
| SYS-6 | **Microsoft 365 / Azure AD** | Staff login (admin portal) | NextAuth SSO |
| SYS-7 | **Vercel Cron** | Scheduled reminder engine | `pages/api/cron/reminders.js` |
| SYS-8 | **AfterShip** `[PLANNED]` | Carrier-agnostic tracking engine (freight + parcel) | To be added as `lib/aftership.js` |

**Two audiences, two logins:**

- **Customers** log in at `/portal` with a one-time email code (no password). Session = signed JWT cookie `summit_customer_session` (7-day expiry). See EP-1/EP-2.
- **Staff** log in at `/admin` with Microsoft 365 SSO (any `@summitsensorygym.com` account). Route protection: `middleware.js`.

---

## 2. Data dictionary — Monday.com "Manufacturing Process" board (ID `6533700776`)

All column IDs are read in `lib/monday.js`. Many are overridable by environment variables (shown where relevant). Columns marked **mirror (read-only)** are sourced from connected boards and cannot be written by the portal.

| Ref | Field (portal name) | Monday column title | Column ID | Type | Written by | Notes |
|---|---|---|---|---|---|---|
| DS-01 | Customer email | Email Address | `email__1` | Email | — | Match key: customer ↔ order |
| DS-02 | **Order status / stage** | Manufacturing Phase | `status__1` | Status | Staff (in Monday) | **Drives the portal progress bar** (see S-flow & SCR-2) |
| DS-03 | Frame tracking # | GB FedEx Tracking Number | `lookup_mm1kcbb5` | Mirror (read-only) | Connected board | Frame shipment tracking (SHP-1) |
| DS-04 | Freight tracking ID | Freight Tracking ID | `dup__of_gb_production7__1` | Mirror (read-only) | Connected board | Alternate freight tracking source |
| DS-05 | Portal files | Portal Files | `file_mm4wbdrh` | File | Staff / admin portal | Files shared to customer (SCR-8) |
| DS-06 | Invoice link | Link to Customer Invoice | `text_mm4wfamc` | Text/URL | Staff | Shown in Invoice tab (SCR-9) |
| DS-07 | Payment link | Payment Portal URL | *(env `MONDAY_COL_PAYMENT_LINK`, unset)* | Text/URL | Staff | `[PARTIAL]` not yet mapped |
| DS-08 | Ship date | Initial Projected Ship Date | `date_mkvvpex1` | Date | Staff | Shown on Status tab |
| DS-09 | Delivery address | Confirmed Delivery Address | `long_text_mkpkdtj4` | Long text | Customer (via portal) | Writable; updated in Delivery tab |
| DS-10 | Product type | Product Series STD Column | `color_mkvw7b8` | Status | Staff | Used for Jotform form matching |
| DS-11 | Mat/pad tracking | *(env `MONDAY_COL_MAT_TRACKING`, unset)* | — | Text | Staff | `[PARTIAL]` Feeds Mats & Padding card (SHP-2); to be replaced by subitem — see PLAN-2 |
| DS-12 | Other shipments | *(env `MONDAY_COL_OTHER_SHIPMENTS`, unset)* | — | Text | Staff | `[PARTIAL]` Format `Label\|Carrier\|Tracking` per line (SHP-3) |
| DS-13 | Installation links | *(installation resources)* | `text_mm4x6xvf` | Text | Staff | Format `Label\|URL` per line (SCR-7) |
| DS-14 | Installation videos | *(env `MONDAY_COL_INSTALLATION_VIDEOS`, unset)* | — | Text | Staff | `[PARTIAL]` YouTube/Vimeo URLs |
| DS-15 | Installation docs | *(env `MONDAY_COL_INSTALLATION_DOCS`, unset)* | — | Text | Staff | `[PARTIAL]` `Label\|URL` per line |
| DS-16 | Color form (direct) | Color Selection Form URL | `text_mm4y44dt` | Text | Staff | Preferred source for Jotform color-form ID |
| DS-17 | Color form (mirror) | *(legacy)* | `lookup_mm4xws1a` | Mirror (read-only) | Connected board | Fallback for DS-16 |
| DS-18 | Phone | POC Phone | `lookup_mkwaee43` | Mirror (read-only) | Connected board | |
| DS-19 | POC name | Delivery POC Name | `lookup_mkwb5bty` | Mirror (read-only) | Connected board | |
| DS-20 | POC email | POC Email | `lookup_mkwazctw` | Mirror (read-only) | Connected board | |
| DS-21 | First name | First Name | `lookup_mkvx85hs` | Mirror (read-only) | Connected board | Used in email greetings |
| DS-22 | Delivery instructions | Special Delivery Instructions | `lookup_mm0anh5a` | Mirror (read-only) | Connected board | |
| DS-23 | Balance due | *(env `MONDAY_COL_BALANCE`, unset)* | — | Numbers | Staff | `[PARTIAL]` not yet mapped |
| DS-33 | Tax Exempt? | Tax Exempt? | `color_mm55tjn2` | Status | Customer (via portal) | `[LIVE]` Yes/No — written via EP-6 (`tax_exemption`); see PLAN-7 |
| DS-34 | Tax exemption cert file | Tax Exemption Certificate | `file_mm55t6kn` | File | Customer (via portal) | `[LIVE]` Uploaded via EP-6 (`tax_exemption`) using the multipart `/v2/file` upload flow; see PLAN-7 |

### 2a. Portal onboarding checklist columns `[LIVE]`

Status columns; label `✅` = complete, `🚫` = incomplete. The portal flips these to `✅` automatically when a customer finishes a section (see EP-6 and the S-2 stages).

| Ref | Portal section | Monday column title | Column ID |
|---|---|---|---|
| DS-24 | Contact | Portal: Contact | `color_mm4ybgaa` |
| DS-25 | Billing | Portal: Billing | `color_mm51e5w9` |
| DS-26 | Delivery & Freight Ack | Portal: Delivery & Freight Ack | `color_mm51j15w` |
| DS-27 | Color Selections | Portal: Color Selections | `color_mm51hjph` |
| DS-28 | Documents | Portal: Documents | `color_mm51yqbz` |

### 2b. Order status → progress-bar stages (DS-02 label map)

Defined in `lib/monday.js` `STATUS_STAGES` (labels overridable via env). The portal matches the current `Manufacturing Phase` label exactly to a stage; unmatched labels default to stage 0.

| Stage index | Stage key | Default Monday label | Icon |
|---|---|---|---|
| 0 | order_placed | Order Placed | 📋 |
| 1 | in_manufacturing | In Manufacturing | 🔧 |
| 2 | ready_to_ship | Ready to Ship | 📦 |
| 3 | shipped | Shipped | 🚚 |
| 4 | delivered | Delivered | ✅ |

### 2c. Monday "tagged updates" (audit trail written to the order's Updates feed)

The portal posts these as updates on the order item. The reminder engine (SYS-7) reads them to know what's complete and when the clock started.

`[PORTAL: Invitation Sent]` · `[PORTAL: Contact Confirmed]` · `[PORTAL: Contact Update Requested]` · `[PORTAL: Billing Information]` · `[PORTAL: Delivery Details]` · `[PORTAL: Freight Delivery Acknowledgment]` · `[PORTAL: Color Selections]` · `[PORTAL: Documents Submitted]` · `[PORTAL: Reminder #N]` · `[PORTAL: Tax Exempt - No]` · `[PORTAL: Tax Exemption Certificate Uploaded]`

### 2d. AfterShip tracking input columns `[LIVE — writable text]`

The portal reads these per order and passes **slug + tracking number** to AfterShip (see PLAN-1). Slug = AfterShip carrier code (e.g. `fedex`, `estes`). These are the current source for shipment tracking, replacing DS-03 (frame) and DS-11 (mats).

| Ref | Shipment | Field | Monday column ID |
|---|---|---|---|
| DS-29 | Sensory Gym Frame (SHP-1) | AfterShip slug (carrier) | `text_mm538vtm` |
| DS-30 | Sensory Gym Frame (SHP-1) | Tracking number | `text_mm53p3b2` |
| DS-31 | Therapy Mats & Padding (SHP-2) | AfterShip slug (carrier) | `text_mm51pap1` |
| DS-32 | Therapy Mats & Padding (SHP-2) | Tracking number | `text_mm51wdm5` |

**AfterShip create-tracking payload (per shipment):** required `tracking_number` (DS-30/DS-32) + `slug` (DS-29/DS-31); recommended `title` (order name), `order_id` (Monday order/subitem ID = match key for webhooks). API key stored in `.env` (`AFTERSHIP_API_KEY`), sent as the `as-api-key` header.

---

## 3. API endpoints (SYS-1)

| Ref | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| EP-1 | `/api/auth/send-code` | POST | public | Email a 6-digit login code (EM-01) |
| EP-2 | `/api/auth/verify-code` | POST | public | Verify code, issue customer session cookie |
| EP-3 | `/api/auth/session-check` | GET | cookie | Validate current customer session |
| EP-4 | `/api/auth/signout-customer` | POST | cookie | Clear customer session |
| EP-5 | `/api/auth/[...nextauth]` | — | Azure AD | Staff SSO (admin) |
| EP-6 | `/api/portal/setup` | POST | customer | Record a completed onboarding section → tagged update + flip checklist column (DS-24…28). Also handles `tax_exemption` (DS-33/DS-34, ongoing — not part of the 5-step checklist) |
| EP-7 | `/api/portal/invite` | POST | staff | Send portal invitation (EM-02) + log `[PORTAL: Invitation Sent]` |
| EP-8 | `/api/monday/order` | GET/PATCH | customer | Fetch the customer's order; PATCH updates address (DS-09) / logs contact change |
| EP-9 | `/api/monday/orders` | GET/PATCH | staff | Admin orders list; edit order fields |
| EP-10 | `/api/monday/columns` · `/debug-columns` | GET | staff | List board columns + IDs (use to fetch new column IDs) |
| EP-11 | `/api/monday/files` | GET/POST | mixed | List / attach files (DS-05) |
| EP-12 | `/api/monday/messages` | GET/POST | mixed | Read / post order messages (updates) |
| EP-13 | `/api/monday/boards` | GET | staff | List boards (settings) |
| EP-14 | `/api/monday/update-webhook` | POST | Monday | Fires on new Monday update; emails customer if a staff member replied (EM-11) |
| EP-15 | `/api/fedex/track?number=` | GET | mixed | Live FedEx tracking for a number (SYS-4) |
| EP-16 | `/api/jotform/webhook` | POST | secret | Jotform submission → match order → tag complete (EM-10 to team) |
| EP-17 | `/api/cron/reminders` | GET | CRON_SECRET | Scheduled reminders (SYS-7) |
| EP-18 | `/api/admin/notify-installation` | POST | staff | Send "installation ready" email (EM-07) |
| EP-19 | `/api/settings/forms` | GET/POST | staff | Manage Jotform form mapping |

---

## 4. Email catalog (SYS-5 / Resend)

From: `portal@updates.summitsensory.com` · Team inbox: `orders@summitsensorygym.com`

| Ref | Email | Trigger | To |
|---|---|---|---|
| EM-01 | Login code | Customer requests sign-in (EP-1) | Customer |
| EM-02 | Portal invitation ("Action Required") | Staff clicks Invite (EP-7) | Customer |
| EM-03 | Setup reminder (escalating tone; urgent at #3+) | Cron (EP-17) until all sections done | Customer |
| EM-04 | Order status change (In Manufacturing / Ready to Ship / Shipped / Delivered) | Staff changes DS-02 **via the admin portal** (EP-9). ⚠️ Editing status **directly in Monday** does NOT trigger this — see OPEN-1 | Customer |
| EM-05 | Color selection form ready | `[PARTIAL]` Defined in code but **not currently wired** to any trigger — see OPEN-2 | Customer |
| EM-06 | Action required on a task | `[PARTIAL]` Defined in code but **not currently wired** — see OPEN-2 | Customer |
| EM-07 | Installation materials ready | Staff (EP-18) | Customer |
| EM-08 | New file shared | File attached via admin portal (EP-11) | Customer |
| EM-09 | Balance / payment update | Staff changes balance **via the admin portal** (EP-9) | Customer |
| EM-10 | Form completed | Jotform webhook (EP-16) | Team |
| EM-11 | Team replied to message | Monday update webhook (EP-14) | Customer |
| EM-12 | Incoming customer message | Customer posts in Messages (EP-12) | Team |
| EM-13 | Contact info changed (⚠️ verify before shipment) | Customer edits contact/delivery | Team |
| EM-14 | Tax exemption certificate submitted | Customer uploads cert (EP-6 `tax_exemption`) | Team |

---

## 5. End-to-end process flow (proposal signed → delivered)

Each stage: **Trigger → Actor → System(s) → Data source(s) → Output/next.**

### Phase 1 — Order created & portal opened

**S-1.1 Proposal signed / order entered** `[LIVE, upstream]`
- **Trigger:** Customer signs proposal.
- **Actor:** Staff.
- **System:** SYS-2. An order item exists on the Manufacturing Process board (DS-01 email, DS-02 status = *Order Placed*, plus mirrored contact fields DS-18…22).
- **Note:** Freight carrier/tracking entry happens on a separate board today — see PLAN-2 for how that connects into this order and its subitems.

**S-1.2 Staff sends portal invitation** `[LIVE]`
- **Trigger:** Staff clicks **✉️ Invite** in the admin orders table (SCR-11).
- **System/endpoint:** EP-7 → sends EM-02 → writes `[PORTAL: Invitation Sent]` to DS/updates.
- **Output:** The reminder clock (SYS-7) starts from this timestamp.

**S-1.3 Customer logs in** `[LIVE]`
- **Trigger:** Customer clicks the portal link, enters email.
- **System/endpoint:** EP-1 (EM-01 code) → EP-2 (verify) → session cookie issued → lands on Dashboard (SCR-1).

### Phase 2 — Customer onboarding (the 5 setup sections)

The portal shows a 5-step setup checklist. Completing each one: (a) posts a tagged update (§2c), and (b) flips its Status column to `✅` (DS-24…28) via EP-6. Manufacturing should not begin until all 5 are complete.

**S-2.1 Contact Information** `[LIVE]` → EP-6 (`contact`) → tag `[PORTAL: Contact Confirmed]` → DS-24 ✅. Contact edits write via EP-8 (address DS-09 direct; phone/name as a change request + EM-13 to team).

**S-2.2 Billing Information** `[LIVE]` → EP-6 (`billing`) → tag `[PORTAL: Billing Information]` → DS-25 ✅ → EM-13/team notify.

**S-2.3 Delivery & Site Details + Freight Acknowledgment** `[LIVE]` → EP-6 (`delivery` and `freight_ack`) → tags `[PORTAL: Delivery Details]` / `[PORTAL: Freight Delivery Acknowledgment]` → DS-26 ✅. Restricted changes (address, liftgate, dock, delivery window) flag the team (EM-13).

**S-2.4 Color & Product Selections** `[LIVE]` → Jotform embedded (form ID from DS-16, fallback DS-17). On submit, EP-16 matches the order by email and tags `[PORTAL: Color Selections]` → DS-27 ✅ + EM-10 to team. Customer may also be prompted by EM-05 when the form is assigned.

**S-2.5 Required Documents** `[LIVE]` → Jotform (documents forms) → EP-16 → tag `[PORTAL: Documents Submitted]` → DS-28 ✅ + EM-10.

**S-2.6 Reminders until complete** `[LIVE]` → SYS-7 (EP-17) runs weekdays 8:00 AM Mountain (`0 14 * * 1-5`). Every `REMINDER_INTERVAL_DAYS` (default 3), up to `REMINDER_MAX_COUNT` (default 6), it emails EM-03 listing only the incomplete sections, and stops automatically once all 5 tags are present. Each send logs `[PORTAL: Reminder #N]`.

### Phase 3 — Manufacturing

**S-3.1 Order moves into production** `[LIVE]`
- **Trigger:** Staff sets DS-02 (Manufacturing Phase) = *In Manufacturing*.
- **Effect:** Portal progress bar advances to stage 1 (SCR-2). EM-04 ("In Manufacturing") is sent **only if the status is changed through the admin portal (EP-9)**; changing DS-02 directly in Monday.com does not send it — see OPEN-1.
- **Recommended gate:** don't advance until DS-24…28 are all `✅` (see PLAN-3 automation).

**S-3.2 Ready to ship** `[LIVE]` → DS-02 = *Ready to Ship* → stage 2 → EM-04 ("Ready to Ship").

### Phase 4 — Shipping & tracking

**S-4.1 Tracking numbers entered** `[LIVE / evolving]`
- **Today:** frame tracking comes from DS-03 (mirror); mats/padding from DS-11 (env, unset); other items from DS-12.
- **Planned:** carrier + tracking entered per shipment and synced to shipment **subitems** with AfterShip as the tracking engine — see PLAN-1 and PLAN-2.

**S-4.2 Status = Shipped** `[LIVE]` → DS-02 = *Shipped* → stage 3 → EM-04 ("Shipped").

**S-4.3 Customer tracks shipments** `[LIVE]`
- **Screen:** Order Status & Tracking (SCR-2). Renders one card per shipment (SHP-1/2/3).
- **Data:** each card calls EP-15 (FedEx Track) per tracking number and shows status + last events.

**Shipment cards on SCR-2:**

| Ref | Card title | Current carrier label | Current data source | Planned |
|---|---|---|---|---|
| SHP-1 | Sensory Gym Frame | "FedEx Freight" | DS-03 → moving to **DS-29 (slug) + DS-30 (tracking)** | AfterShip via DS-29/DS-30 (PLAN-1) |
| SHP-2 | Therapy Mats & Padding | "Standard Carrier" (hidden if `N/A`) | DS-11 → moving to **DS-31 (slug) + DS-32 (tracking)** | AfterShip via DS-31/DS-32 (PLAN-1) |
| SHP-3 | Additional Order Items | per-line carrier | DS-12 (`Label\|Carrier\|Tracking`) | "Miscellaneous Equipment & Accessories" section (PLAN-4) |

### Phase 5 — Delivery & post-delivery

**S-5.1 Delivered** `[LIVE]` → DS-02 = *Delivered* → stage 4 → EM-04 ("Delivered").

**S-5.2 Installation materials** `[LIVE]` → Staff triggers EP-18 → EM-07. Installation tab (SCR-7) shows videos/docs/links from DS-13/DS-14/DS-15.

**S-5.3 Ongoing support** `[LIVE]` → Messages (SCR-10, EP-12) two-way: customer message → EM-12 to team; staff reply in Monday → EP-14 → EM-11 to customer. Files (SCR-8) and Invoice/Payment (SCR-9, DS-06/DS-07/DS-23) remain available.

**S-5.4 Tax exemption certificate** `[LIVE]` → Invoice & Payment tab (SCR-9) → customer selects Yes/No. **No** → EP-6 (`tax_exemption`) sets DS-33 = *No* + tag `[PORTAL: Tax Exempt - No]`; nothing further requested. **Yes** → customer uploads a certificate → EP-6 uploads the file to DS-34 via the multipart `/v2/file` endpoint, sets DS-33 = *Yes*, tags `[PORTAL: Tax Exemption Certificate Uploaded]`, and sends EM-14 to the team for review. Portal always displays: without an approved certificate on file, sales tax applies to the invoice.

---

## 6. Customer portal screen map (`/portal`)

**Setup tabs (onboarding):** Contact · Billing · Delivery & Site Details · Color & Product Selections · Required Documents (map to S-2.1…2.5).

**Order tabs (ongoing):**

| Ref | Tab | Purpose | Key data sources |
|---|---|---|---|
| SCR-1 | Dashboard | Overview + setup progress | DS-02, DS-24…28 |
| SCR-2 | Order Status | Progress bar + shipment tracking | DS-02 (bar), SHP-1/2/3, EP-15 |
| SCR-7 | Installation | Videos, docs, resources | DS-13/14/15 |
| SCR-8 | Files & Documents | Shared files | DS-05, EP-11 |
| SCR-9 | Invoice & Payment | Invoice link, balance, tax exemption cert upload | DS-06, DS-07, DS-23, DS-33, DS-34 |
| SCR-10 | Messages | Two-way messaging | EP-12, EM-11/EM-12 |
| SCR-11 | Contact Us | Support info | static |

**Admin portal (`/admin`, staff):** orders table with inline edit + **✉️ Invite** (EP-7/EP-9), file manager (EP-11), messages (EP-12), and settings for column mapping (EP-10), Jotform forms (EP-19), and boards (EP-13).

---

## 7. Planned / open items (change backlog)

| Ref | Item | Status | Summary |
|---|---|---|---|
| PLAN-1 | **AfterShip tracking engine** | `[PLANNED]` | Add `lib/aftership.js` (carrier-agnostic); make the track endpoint carrier-aware; retire FedEx-only limitation. Carrier "slug" examples: FedEx=`fedex`, Estes=`estes`, UPS=`ups`, USPS=`usps`. |
| PLAN-2 | **Shipments as Monday subitems** | `[PLANNED]` | Each shipment = a subitem (Sensory Gym Frame, Therapy Mats & Padding, Miscellaneous Equipment & Accessories) with columns: Carrier (dropdown→slug), Tracking Number, Delivery Status (9 AfterShip states), Est. Delivery, Last Checkpoint, Show in Portal, + optional Ship Date / Hide Carrier from Customer. Portal reads shipments from subitems instead of DS-11/DS-12. |
| PLAN-3 | **Freight board → Manufacturing subitem sync** | `[PLANNED]` | Carrier + tracking entered on a separate board; match to this order (prefer a shared Order ID over customer name) and write to the correct subitem (e.g. Therapy Mats & Padding) via Make.com or integration code. |
| PLAN-4 | **"Miscellaneous Equipment & Accessories" (Amazon) section** | `[PLANNED]` | Third shipment section; never reference Amazon to the customer; suppress carrier name (Amazon Logistics). Auto-pull via Amazon Business API / AfterShip email parser, matched by ship-to address. |
| PLAN-5 | **Notifications via portal's own layer** | `[PLANNED]` | Route AfterShip status webhooks → Resend (SYS-5) so wording/branding is controlled and carrier/Amazon references can be stripped. |
| PLAN-6 | **"Ready to Manufacture" gate & view** | `[PLANNED]` | Monday view filtered to DS-24…28 all `✅`; optional automation to auto-advance DS-02. |
| PLAN-7 | **Tax Exemption Certificate upload (SCR-9)** | `[LIVE — built 2026-07-11]` | Added a "Tax Exemption Certificate" module to the Invoice & Payment tab (S-5.4). Yes/No selector writes DS-33; uploading a certificate writes the file to DS-34 via a new `uploadFileToColumn()` helper in `lib/monday.js` (multipart request to Monday's dedicated `/v2/file` endpoint — the existing `addFileToOrder()` helper only supports URL-based files and can't be used for direct customer uploads). Staff should periodically review uploaded certificates in Monday and follow up if a certificate looks invalid or expired — there is no automatic approval/expiration workflow yet. |
| OPEN-1 | Status/balance emails only fire from the admin portal | `[GAP]` | EM-04 and EM-09 are triggered by EP-9 (admin order edit) only. If staff change **Manufacturing Phase (DS-02)** or balance **directly in Monday.com**, no customer email is sent. Fix: add a Monday automation → webhook that fires EM-04 on DS-02 change regardless of where it's edited. |
| OPEN-2 | EM-05 / EM-06 defined but not wired | `[GAP]` | Both emails exist in `lib/email.js` but have no trigger. Decide whether to wire them (EM-05 on color-form assignment; EM-06 for ad-hoc tasks) or remove. |

---

## 8. Change-request template (copy/paste when asking Claude)

```
Reference: <code, e.g. S-4.3 / DS-11 / EM-04 / SHP-2 / PLAN-2>
Type: Add | Change | Delete
What I want:
Why:
Any new Monday column IDs (from /api/monday/debug-columns):
```
