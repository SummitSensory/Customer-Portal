/**
 * POST /api/portal/setup
 * Saves customer account setup data for a given tab.
 * Body: { tab, data }
 *
 * Tabs handled:
 *   contact         — confirmation only (data lives in Monday mirrors)
 *   billing         — stores billing address + POC as a tagged Monday update
 *   delivery        — saves editable fields + freight acknowledgment
 *   tax_exemption   — Yes/No status (color_mm55tjn2) + certificate upload (file_mm55t6kn)
 *
 * Optional body field `orderId` (AUDIT-2026-10-06): when present and not the
 * session's bound order → 409 ORDER_MISMATCH before anything else runs (see
 * rejectOrderMismatch in lib/apiAuth.js).
 *
 * AUDIT-2026-10-06: the legacy 'freight_ack' tab was removed — see the note
 * where its case used to be.
 */

import {
  updateOrderColumn,
  postTaggedUpdate,
  markSectionCompleteSafe,
  createDeliverySubmissionItem,
  findRecentDeliverySubmission,
  setStatusLabel,
  uploadFileToColumn,
  COLS,
  STATUS_STAGES,
  TAX_EXEMPT_YES_LABEL,
  TAX_EXEMPT_NO_LABEL,
  PORTAL_DONE_LABEL,
} from '../../../lib/monday';
import { requireCustomerSession, loadSessionOrder, enforceRateLimit, rejectOrderMismatch, staffAttribution, sessionActorLabel } from '../../../lib/apiAuth';

// PORTAL-017: the Delivery tab's UI hides its form once an order has shipped
// (order.stageIndex >= shippedIdx, see DeliveryTab in pages/portal/index.js),
// but that was ONLY a client-side gate — this handler processed and saved
// delivery/freight_ack submissions regardless of shipment stage. A stale
// already-open tab, a replayed request, or a direct API call could silently
// write a "new" delivery address for an order already in transit to the old
// one. Mirrors the same shippedIdx logic server-side.
const SHIPPED_STAGE_INDEX = STATUS_STAGES.findIndex(s => s.key === 'shipped');
function isOrderShipped(order) {
  return SHIPPED_STAGE_INDEX >= 0 && (order.stageIndex ?? 0) >= SHIPPED_STAGE_INDEX;
}
import { notifyTeamContactChange, notifyTeamFormCompleted } from '../../../lib/email';
import { reportCriticalFailure } from '../../../lib/monitoring';

// Fields that require Summit confirmation when changed.
// PORTAL-046: these values must match EXACTLY what DeliveryTab's
// getChangedRestricted() in pages/portal/index.js actually pushes into
// changedRestricted ('Ship-To Address' / 'Preferred Delivery Timing' /
// 'Loading Dock / Liftgate Requirement') — this list previously used
// unrelated machine-style keys ('deliveryAddress', 'liftgate', 'loadingDock',
// 'deliveryWindow') that never matched any real client value, so the
// .filter() below silently produced an empty array on every single
// submission. Since the PORTAL-034 fix, that meant: safeChangedRestricted
// was always [], requiresConfirmation was always false in the API response,
// the Monday-bound submission item's changedRestricted was always [], and
// staff's "Contact Information Updated" email always fell through to the
// generic "Delivery Details" fallback (see notifyFields below) instead of
// ever naming which specific restricted field actually changed.
const RESTRICTED_FIELDS = ['Ship-To Address', 'Preferred Delivery Timing', 'Loading Dock / Liftgate Requirement'];

// PORTAL-018-IDEMPOTENCY: the PORTAL-018 comment on the 'delivery' case
// (further down, where freightAckBy/freightAckDate get folded into this same
// request) calls the combined delivery+freight-ack submission "atomic" — but
// it's really a sequence of independently-awaited Monday writes with no
// rollback and no idempotency key. A failure partway through (Monday API
// blip, connection reset) surfaces to the customer as a generic 500, and the
// natural response — clicking Submit again, or a lost-response retry where
// the FIRST request actually completed fine server-side but the client never
// saw the 200 — re-runs the whole handler, including steps that already
// succeeded. Most of those re-runs are harmless (updateOrderColumn
// overwrites the same columns, postTaggedUpdate just appends another log
// entry staff can ignore), but createDeliverySubmissionItem() (a new row on
// the Delivery & Site Details Submissions board) and notifyTeamContactChange()
// (a staff email) are both CUSTOMER-VISIBLE duplicates a retry would create —
// a second row staff has to notice and reconcile, a second "Contact
// Information Updated" email. This in-memory guard (same per-instance,
// resets-on-cold-start scope/limitations as lib/rateLimit.js's `buckets` —
// see that file's header) remembers the content of the last delivery
// submission per order and skips re-creating the submission row / re-sending
// the notification when a near-identical submission for the SAME order was
// already recorded within the last 60 seconds. Matching on content (not just
// order + timing) is deliberate: two genuinely different submissions from
// the same customer within a minute (e.g. they immediately noticed a typo
// and resubmitted with a real change) must both go through — only an exact
// repeat of the same payload is treated as a retry.
//
// This in-memory guard alone was never a complete cross-instance/cross-
// cold-start idempotency guarantee — a retry landing on a different warm
// instance, or after this one recycled, sailed right past it. That gap is
// now closed by findRecentDeliverySubmission (lib/monday.js), which actually
// checks the real Delivery & Site Details Submissions board for a matching
// recent row before a new one gets created — see its own header comment.
// This in-memory guard stays as the cheap first check (catches the common
// same-instance case with zero extra Monday API calls); the Monday-side
// check only runs when this one doesn't already flag a duplicate.
const recentDeliverySubmissions = new Map(); // order.id -> { signature, at }
const DELIVERY_DEDUP_WINDOW_MS = 60_000;

function isDuplicateDeliverySubmission(orderId, signature) {
  const prev = recentDeliverySubmissions.get(orderId);
  return !!prev && prev.signature === signature && (Date.now() - prev.at) < DELIVERY_DEDUP_WINDOW_MS;
}

function rememberDeliverySubmission(orderId, signature) {
  recentDeliverySubmissions.set(orderId, { signature, at: Date.now() });
  // Bound memory growth exactly like lib/rateLimit.js's `buckets` sweep.
  if (recentDeliverySubmissions.size > 5000) {
    const now = Date.now();
    for (const [key, entry] of recentDeliverySubmissions) {
      if (now - entry.at >= DELIVERY_DEDUP_WINDOW_MS) recentDeliverySubmissions.delete(key);
    }
  }
}

// PORTAL-010: this handler previously did zero validation beyond "tab and
// data required" — any authenticated session could POST empty strings or
// malformed data for any tab and it would still write to Monday and mark
// the section ✅ complete. Mirrors the required-field + email-format
// checks pages/api/referral/submit.js already does correctly for its own
// form. Returns a plain string error message, or null if valid.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isBlank = (v) => typeof v !== 'string' || !v.trim();

function validateSetupData(tab, data) {
  switch (tab) {
    case 'contact_update': {
      const { name, phone, email } = data;
      if (!name && !phone && !email) return 'At least one field (name, phone, or email) is required.';
      if (email && !EMAIL_PATTERN.test(email)) return 'Please enter a valid email address.';
      return null;
    }
    case 'billing': {
      const { billingAddress, billingCity, billingContactSameAsPrimary, billingName, billingPhone, billingEmail } = data;
      if (isBlank(billingAddress)) return 'Billing address is required.';
      if (isBlank(billingCity)) return 'Billing city is required.';
      if (!billingContactSameAsPrimary) {
        if (isBlank(billingName)) return 'Billing contact name is required.';
        if (isBlank(billingPhone)) return 'Billing contact phone is required.';
        if (isBlank(billingEmail) || !EMAIL_PATTERN.test(billingEmail)) return 'A valid billing contact email is required.';
      }
      return null;
    }
    case 'delivery': {
      const { pocName, pocPhone, pocEmail, addressConfirmed, addressLine1, addressCity, addressState, addressZip,
              hasSecondaryPoc, secondaryPocName, secondaryPocPhone, freightAckBy, freightAckDate } = data;
      if (isBlank(pocName)) return 'Delivery point-of-contact name is required.';
      if (isBlank(pocPhone)) return 'Delivery point-of-contact phone is required.';
      if (isBlank(pocEmail) || !EMAIL_PATTERN.test(pocEmail)) return 'A valid delivery point-of-contact email is required.';
      // A new/updated ship-to address is only required when the customer
      // said the address on file is NOT correct (addressConfirmed === false).
      if (addressConfirmed === false) {
        if (isBlank(addressLine1)) return 'A delivery street address is required.';
        if (isBlank(addressCity)) return 'A delivery city is required.';
        if (isBlank(addressState)) return 'A delivery state is required.';
        if (isBlank(addressZip)) return 'A delivery zip/postal code is required.';
      } else if (isBlank(addressLine1) || isBlank(addressCity)) {
        // "Yes, this is correct" is only meaningful when there IS an address
        // on file. With none, the client still let the customer confirm it
        // and the Delivery & Site Details Submissions row went in with every
        // ship-to column blank (Pediatric Therapy Associates, 2026-09-08 —
        // staff had to fill it in by hand a week later). The client derives
        // these fields from the address on file (shipToParts), so blank here
        // means there was nothing real to confirm.
        return 'We don\'t have a complete ship-to address on file for this order — please choose "No, I need to update it" and enter the address.';
      }
      if (Array.isArray(data.primaryCommMethods) && data.primaryCommMethods.includes('Text Message') && isBlank(data.primaryMobilePhone)) {
        return 'A mobile number is required when Text Message is a preferred communication method.';
      }
      if (hasSecondaryPoc && Array.isArray(data.secondaryCommMethods) && data.secondaryCommMethods.includes('Text Message') && isBlank(data.secondaryMobilePhone)) {
        return 'A mobile number for the secondary contact is required when Text Message is selected for them.';
      }
      if (hasSecondaryPoc) {
        if (isBlank(secondaryPocName)) return 'A secondary contact name is required when a secondary contact is enabled.';
        if (isBlank(secondaryPocPhone)) return 'A secondary contact phone is required when a secondary contact is enabled.';
      }
      // PORTAL-018-FOLLOWUP: the 'delivery' case's own PORTAL-018 comment
      // (below, around the freightAckBy/freightAckDate write) claims these
      // two fields are "already required fields on this same form" (per
      // ackName/ackRead validation in DeliveryTab) and that folding freight
      // acknowledgment into this single request is what makes the combined
      // submission atomic — but that claim was never actually enforced HERE.
      // This function only validated the delivery fields above; freightAckBy/
      // freightAckDate were optional as far as the server was concerned (the
      // handler below only acts on them `if (freightAckBy && freightAckDate)`
      // and silently skips posting the acknowledgment update otherwise). That
      // meant a direct/scripted POST to this endpoint — bypassing DeliveryTab's
      // client-side ackName/ackRead checks entirely — could mark Delivery
      // fully complete (markSectionCompleteSafe below always runs) without
      // ever recording freight acknowledgment. Requiring both here closes
      // that gap and makes the server-side validation actually match what
      // the PORTAL-018 comment already claimed was true.
      if (isBlank(freightAckBy)) return 'A name is required to acknowledge freight delivery requirements.';
      if (isBlank(freightAckDate)) return 'An acknowledgment date is required.';
      return null;
    }
    // 'contact' and 'color' completion markers carry no
    // customer-entered fields to validate; 'tax_exemption' validates its
    // upload via validateTaxCertUpload() (AUDIT-2026-10-06) inline below.
    default:
      return null;
  }
}

// AUDIT-2026-10-06: the tax-exemption upload took any base64 blob with any
// name/MIME type and any size, straight into Monday's file column. Now:
//   - the extension must be one TaxExemptionCard's file input offers
//     (pages/portal/index.js: accept=".pdf,.jpg,.jpeg,.png,.heic,.heif");
//   - a supplied MIME type must be on the allowlist too. A blank or generic
//     application/octet-stream type is tolerated and the type is derived
//     from the extension instead — browsers (Chrome on Windows especially)
//     report HEIC photos with an empty file.type, and rejecting those would
//     lock real customers out of uploading a phone photo of a certificate;
//   - decoded size is capped at 3MB. Vercel rejects request bodies over
//     4.5MB outright (before this handler runs, whatever sizeLimit says
//     below), and base64 inflates by 4/3, so ~3MB of file is the most that
//     reliably arrives — a clear 413 beats an opaque platform error.
const TAX_CERT_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
};
const TAX_CERT_ALLOWED_MIME = new Set(Object.values(TAX_CERT_TYPES));
export const TAX_CERT_MAX_BYTES = 3 * 1024 * 1024;
const TAX_CERT_TYPE_ERROR = 'Please upload your certificate as a PDF, JPG, PNG, or HEIC file.';
const TAX_CERT_SIZE_ERROR = 'That file is too large to upload here (3 MB maximum). Please upload a smaller scan or photo, or email it to orders@summitsensory.com.';

// Returns { status, error } on failure, or { buffer, fileName, mimeType }.
export function validateTaxCertUpload({ fileBase64, fileName, mimeType } = {}) {
  if (typeof fileBase64 !== 'string' || !fileBase64 || typeof fileName !== 'string' || !fileName.trim()) {
    return { status: 400, error: 'Please upload your tax exemption certificate.' };
  }
  const name = fileName.trim();
  const extMime = name.includes('.') ? TAX_CERT_TYPES[name.split('.').pop().toLowerCase()] : undefined;
  if (!extMime) return { status: 400, error: TAX_CERT_TYPE_ERROR };
  const suppliedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  const genericMime = !suppliedMime || suppliedMime === 'application/octet-stream';
  if (!genericMime && !TAX_CERT_ALLOWED_MIME.has(suppliedMime)) return { status: 400, error: TAX_CERT_TYPE_ERROR };
  // Cheap pre-check on the encoded length before decoding anything.
  if (fileBase64.length > Math.ceil(TAX_CERT_MAX_BYTES / 3) * 4 + 4) return { status: 413, error: TAX_CERT_SIZE_ERROR };
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length === 0) return { status: 400, error: 'The uploaded file appears to be empty. Please choose the file again.' };
  if (buffer.length > TAX_CERT_MAX_BYTES) return { status: 413, error: TAX_CERT_SIZE_ERROR };
  return { buffer, fileName: name, mimeType: genericMime ? extMime : suppliedMime };
}

// Tax exemption certificate uploads arrive as base64 in the JSON body — raise
// the default 1mb Next.js body limit so scanned PDFs/photos aren't rejected.
// (Vercel's own 4.5MB request cap still applies first — see TAX_CERT_MAX_BYTES.)
export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const session = await requireCustomerSession(req, res);
  if (!session) return;

  // AUDIT-2026-10-06: a tab still showing a different order than this
  // browser's session is now bound to — see rejectOrderMismatch.
  if (!rejectOrderMismatch(req, session, res)) return;

  // PORTAL-027: most tabs here trigger a team-notification email on every
  // save. See lib/rateLimit.js for the in-memory limiter's scope/limitations.
  if (!enforceRateLimit(res, `portal-setup:${session.email}`, { maxRequests: 20, windowMs: 60_000 })) return;

  const { tab, data } = req.body || {};
  if (!tab || !data) return res.status(400).json({ error: 'tab and data required.' });

  const validationError = validateSetupData(tab, data);
  if (validationError) return res.status(400).json({ error: validationError });

  // Extracted 2026-09-03 (shared with pages/api/portal/color-selection.js
  // via lib/apiAuth.js) — now also fails closed with a clear 400 if a
  // session somehow has no orderId (previously would have let
  // getOrderById(undefined) behave however Monday's API responds to a
  // missing item id), and logs a load failure instead of the previous
  // silent 500. Real orderId is always present in practice (every session
  // is created with one — see signCustomerSession in lib/auth.js), so this
  // changes nothing for normal use.
  const order = await loadSessionOrder(session, res, { logPrefix: 'portal-setup' });
  if (!order) return;

  // AUDIT-2026-10-06: a staff member "viewing as customer" (impersonation
  // session) must never look like the customer's own action — every Monday
  // audit update and team email below says who actually did it.
  const attribution = staffAttribution(session);
  const actor = sessionActorLabel(session);
  const audit = (itemId, tag, content) => postTaggedUpdate(itemId, tag, `${content}${attribution}`);

  try {
    switch (tab) {

      // ── Tab 1: Contact — confirmation only ──────────────────────────────
      case 'contact': {
        await audit(order.id, 'PORTAL: Contact Confirmed',
          `Customer confirmed contact information on ${new Date().toLocaleDateString()}.`
        );
        await notifyTeamContactChange(order.name, actor, ['Contact Information Confirmed']).catch(console.error);
        // PORTAL-014: retried and reported honestly instead of swallowed —
        // see markSectionCompleteSafe() in lib/monday.js.
        const contactSynced = await markSectionCompleteSafe(order.id, 'portalContact');
        return res.status(200).json({ ok: true, checklistSyncPending: !contactSynced });
      }

      // ── Tab 1b: Contact — editable update ────────────────────────────────
      case 'contact_update': {
        const { name, phone, email: newEmail } = data;
        const lines = [
          `Customer requested contact information update on ${new Date().toLocaleDateString()}.`,
          name     ? `Name: ${name}`   : null,
          phone    ? `Phone: ${phone}` : null,
          newEmail ? `Email: ${newEmail}` : null,
        ].filter(Boolean);
        await audit(order.id, 'PORTAL: Contact Update Requested', lines.join('\n'));
        await notifyTeamContactChange(
          order.name,
          actor,
          [name && 'Name', phone && 'Phone', newEmail && 'Email'].filter(Boolean)
        ).catch(console.error);
        const contactUpdateSynced = await markSectionCompleteSafe(order.id, 'portalContact');
        return res.status(200).json({ ok: true, checklistSyncPending: !contactUpdateSynced });
      }

      // ── Tab 2: Billing ──────────────────────────────────────────────────
      case 'billing': {
        const {
          billingAddress, billingAddressSuite, billingCity, billingState, billingZip, billingCountry,
          billingContactSameAsPrimary,
          billingName, billingPhone, billingEmail,
        } = data;

        let addressText = billingAddress;
        if (billingAddressSuite) addressText += `, ${billingAddressSuite}`;
        addressText += `, ${billingCity}`;
        if (billingState) addressText += `, ${billingState}`;
        if (billingZip) addressText += ` ${billingZip}`;
        if (billingCountry) addressText += `, ${billingCountry}`;

        const contactText = billingContactSameAsPrimary
          ? `Same as primary contact`
          : `${billingName} | ${billingPhone} | ${billingEmail}`;

        // Write the confirmed address immediately (no staff review step) so it's
        // reflected right away as the Billing tab's "on file" address and as the
        // default ship-to address on the Delivery Logistics tab.
        // long_text columns require the complex value wrapped as {text: "..."} —
        // a bare string throws "invalid value" (same bug class fixed 2026-07-28
        // on COLS.address and the Delivery/Referral long_text writes).
        await updateOrderColumn(order.id, COLS.billingAddressConfirmed, { text: addressText });

        // Also snapshot every field the customer actually typed — including the
        // decomposed address components and billing POC, none of which had any
        // other home in Monday before this — so the Billing tab can restore
        // exactly what was submitted the next time this customer opens it,
        // instead of showing blank fields with only the combined address text
        // above. This write is NOT best-effort: if it fails, the whole request
        // fails and the customer sees an error rather than a false "saved".
        await updateOrderColumn(order.id, COLS.billingSnapshot, { text: JSON.stringify({
          billingAddress, billingAddressSuite, billingCity, billingState, billingZip, billingCountry,
          billingContactSameAsPrimary, billingName, billingPhone, billingEmail,
        }) });

        await audit(order.id, 'PORTAL: Billing Information',
          `Billing Address: ${addressText}\nBilling Contact: ${contactText}\nSubmitted: ${new Date().toLocaleDateString()}`
        );
        // "Contact Info Changed" only when billing was already complete — a
        // first-time submission is just onboarding (shown by the Portal:
        // Billing column), and alerting on it sent 3–4 "changed" emails per
        // new customer (40 in three weeks).
        if (order.progress?.billing === PORTAL_DONE_LABEL) {
          await notifyTeamContactChange(order.name, actor, ['Billing Information']).catch(console.error);
        }
        const billingSynced = await markSectionCompleteSafe(order.id, 'portalBilling');
        return res.status(200).json({ ok: true, checklistSyncPending: !billingSynced });
      }

      // ── Tab 3: Delivery ─────────────────────────────────────────────────
      case 'delivery': {
        // PORTAL-017: reject once the order has shipped — see isOrderShipped() above.
        if (isOrderShipped(order)) {
          return res.status(409).json({ error: 'This order has already shipped — delivery details can no longer be changed through the portal. Contact Summit Sensory Gym directly for any changes.' });
        }
        const {
          pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
          hasSecondaryPoc, secondaryPocName, secondaryPocPhone, secondaryPhoneCanText, secondaryPocEmail,
          primaryCommMethods, primaryMobilePhone,
          secondaryCommMethods, secondaryMobilePhone,
          addressConfirmed, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
          formattedAddress,
          loadingDock, deliveryTiming, preferredDeliveryDate,
          // Raw form-control values (as opposed to the human-readable labels
          // above, e.g. loadingDock/deliveryTiming) — sent solely so this
          // snapshot can restore the form's actual controls on the next
          // visit. See pages/portal/index.js DeliveryTab.
          hasLoadingDock, deliveryTimingOption, ackRead,
          changedRestricted,
          freightAckBy, freightAckDate,
        } = data;

        // PORTAL-034: changedRestricted used to be passed straight from the
        // client into notifyTeamContactChange's HTML email and the
        // submissions board with no validation at all — RESTRICTED_FIELDS
        // above exists for exactly this purpose (the real, known set of
        // fields that actually require staff confirmation) but was never
        // actually applied to it. An authenticated customer session could
        // otherwise inject arbitrary text — including a crafted HTML
        // link — straight into a trusted-domain internal email. Whitelisting
        // here closes both that injection vector and the more basic bug of
        // treating any client-supplied string as a "restricted field."
        const safeChangedRestricted = Array.isArray(changedRestricted)
          ? changedRestricted.filter((f) => RESTRICTED_FIELDS.includes(f))
          : [];

        // Snapshot every field exactly as submitted (including the raw
        // yes/no + asap/scheduled control values, not just the human-readable
        // labels above) so the Delivery tab can restore what the customer
        // actually entered on their next visit — previously these ~20 fields
        // existed only in this component's local React state and reset to
        // blank every time the tab unmounted (switching tabs, reloading, or
        // logging in from a different device), even though Monday had a full
        // record of the submission elsewhere. This write is NOT best-effort:
        // a failure here fails the whole request so the customer sees a real
        // error instead of a false "saved" confirmation.
        await updateOrderColumn(order.id, COLS.deliverySnapshot, { text: JSON.stringify({
          pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
          hasSecondaryPoc, secondaryPocName, secondaryPocPhone, secondaryPhoneCanText, secondaryPocEmail,
          primaryCommMethods, primaryMobilePhone, secondaryCommMethods, secondaryMobilePhone,
          addressConfirmed, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
          hasLoadingDock, deliveryTimingOption, preferredDeliveryDate,
          ackRead, ackName: freightAckBy,
        }) });

        // Save the ship-to address on the order record — always, not just when
        // the customer typed a brand-new one. PORTAL-BUG-2026-08-31: this used to
        // gate on `addressConfirmed === false`, on the assumption that "confirmed"
        // meant nothing changed. But shipToParts() (pages/portal/index.js) builds
        // formattedAddress from the Billing Information tab's address whenever
        // addressConfirmed !== false — so a customer who fixes their address on the
        // Billing tab and then clicks "Yes, this is correct" here submits a fully
        // correct formattedAddress that this handler silently discarded, leaving
        // whatever wrong address was on file from an earlier submission. Real case:
        // Waunakee Community School District confirmed "905 Bethel Circle" twice
        // (8/31) and it never overwrote the original wrong "1025 Quinn Drive" (8/30)
        // because addressConfirmed was true both times. formattedAddress is always
        // populated by shipToParts() regardless of the confirm answer (see comment
        // there), so it's always safe — and correct — to write it here.
        // Monday's long_text columns require the complex value wrapped as
        // {text: "..."} — a bare string throws "invalid value" (confirmed
        // 2026-07-28 via a live GraphQL error on this exact call).
        if (formattedAddress) {
          await updateOrderColumn(order.id, COLS.address, { text: formattedAddress });
        }

        // Log the full delivery submission as a tagged update on the order (quick read for staff in Monday updates)
        const phoneNote = phoneCanText ? ' (can text)' : '';
        const primaryCommNote = Array.isArray(primaryCommMethods) ? primaryCommMethods.join(', ') : (primaryCommMethods || 'Email');
        const secondaryCommNote = Array.isArray(secondaryCommMethods) ? secondaryCommMethods.join(', ') : (secondaryCommMethods || '');
        const secondaryNote = hasSecondaryPoc
          ? `${secondaryPocName || '—'} | ${secondaryPocPhone || '—'}${secondaryPhoneCanText ? ' (can text)' : ''} | ${secondaryPocEmail || '—'}`
          : 'None';
        const lines = [
          `Primary Delivery POC: ${pocName || '—'} | ${pocPhone || '—'}${phoneNote} | ${pocEmail || '—'}`,
          `Primary Preferred Communication: ${primaryCommNote}${primaryMobilePhone ? ` — Mobile: ${primaryMobilePhone}` : ''}`,
          `Secondary Delivery POC: ${secondaryNote}`,
          hasSecondaryPoc ? `Secondary Preferred Communication: ${secondaryCommNote || 'Email'}${secondaryMobilePhone ? ` — Mobile: ${secondaryMobilePhone}` : ''}` : null,
          `Special Instructions: ${specialInstructions || 'None'}`,
          `Ship-To Address Confirmed: ${addressConfirmed === false ? 'No — updated' : 'Yes'}`,
          formattedAddress ? `Ship-To Address: ${formattedAddress}` : null,
          loadingDock ? `Loading Dock: ${loadingDock}` : null,
          deliveryTiming ? `Delivery Timing: ${deliveryTiming}` : null,
          `Submitted: ${new Date().toLocaleDateString()}`,
        ].filter(Boolean);

        await audit(order.id, 'PORTAL: Delivery Details', lines.join('\n'));

        // PORTAL-018: the freight acknowledgment used to be a SECOND,
        // separate POST from the frontend (saveSetup('freight_ack', ...)
        // fired right after this one). Two sequential HTTP requests for what
        // is, from the customer's perspective, a single "Submit" click meant
        // a failure between them (network blip, tab closed) left the
        // delivery details saved but the acknowledgment missing, and a retry
        // re-ran the first write again — duplicating the tagged update and
        // the Delivery & Site Details Submissions board row. freightAckBy/
        // freightAckDate are already required fields on this same form
        // (see ackName/ackRead validation in DeliveryTab), so folding the
        // acknowledgment into this single request makes the whole
        // submission atomic — it either succeeds together or fails
        // together, no partial state and no accidental double-submit. The
        // separate 'freight_ack' case was kept for backward
        // compatibility with older deployed frontends until AUDIT-2026-10-06
        // removed it (see where that case used to be, below).
        if (freightAckBy && freightAckDate) {
          await audit(order.id, 'PORTAL: Freight Delivery Acknowledgment',
            `Acknowledged by: ${freightAckBy}\nDate: ${freightAckDate}\nCustomer has read and agreed to all freight delivery requirements.`
          );
        }

        // Push the full structured submission to the standalone Delivery &
        // Site Details Submissions board in Monday (one row per submission),
        // and notify the team — skipped when this is a retry of a submission
        // already recorded moments ago. See the PORTAL-018-IDEMPOTENCY
        // comment near the top of this file for why this guard exists and
        // exactly what it does/doesn't cover.
        const deliverySubmissionPayload = {
          customerEmail: session.email,
          pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
          hasSecondaryPoc, secondaryPocName, secondaryPocPhone, secondaryPhoneCanText, secondaryPocEmail,
          primaryCommMethods, primaryMobilePhone,
          secondaryCommMethods, secondaryMobilePhone,
          addressConfirmed, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
          formattedAddress,
          loadingDock, deliveryTiming, preferredDeliveryDate,
          changedRestricted: safeChangedRestricted,
          freightAckBy, freightAckDate,
        };
        const deliverySubmissionSignature = JSON.stringify(deliverySubmissionPayload);
        let isRetryOfRecentSubmission = isDuplicateDeliverySubmission(order.id, deliverySubmissionSignature);
        if (!isRetryOfRecentSubmission) {
          // The in-memory guard above only catches a retry that lands on
          // THIS same warm serverless instance. A retry on a DIFFERENT
          // instance, or after this one has cold-started fresh, sails right
          // past it — findRecentDeliverySubmission (lib/monday.js) is the
          // cross-instance backstop: it actually asks Monday whether a
          // matching row was already created for this order in the last
          // minute. Failing this open (treat as "not a duplicate") on a
          // Monday read error matches the in-memory guard's own risk
          // profile — worst case is the same harmless duplicate-row/email
          // this whole guard exists to reduce, not a customer-visible error.
          try {
            const recentMatch = await findRecentDeliverySubmission(order.id, deliverySubmissionPayload);
            isRetryOfRecentSubmission = !!recentMatch;
          } catch (err) {
            console.error('findRecentDeliverySubmission failed (treating as not-a-duplicate):', err.message);
          }
        }

        if (isRetryOfRecentSubmission) {
          console.warn(`portal-setup: skipped duplicate delivery submission side effects for order ${order.id} (identical content resubmitted within ${DELIVERY_DEDUP_WINDOW_MS}ms)`);
        } else {
          // Recorded BEFORE the writes below (not after they succeed) —
          // createDeliverySubmissionItem/notifyTeamContactChange are already
          // best-effort (.catch()-guarded, don't fail this request), so the
          // real risk this guard closes is the request having already fully
          // succeeded server-side while the client never saw the response and
          // retries; recording early is what actually catches that case.
          rememberDeliverySubmission(order.id, deliverySubmissionSignature);

          // Still best-effort for the customer (the snapshot + tagged update
          // above already hold everything), but no longer silent: a missing
          // row on the submissions board is exactly what staff/the CRM read,
          // so a failure here has to reach a human.
          await createDeliverySubmissionItem(order, deliverySubmissionPayload)
            .catch(err => reportCriticalFailure('delivery-submission-board',
              `Delivery & Site Details submission for "${order.name}" (order ${order.id}) was NOT written to the submissions board. The full details are in the order's "PORTAL: Delivery Details" update — add the row manually.`,
              { orderId: order.id, error: err?.message }));

          // Notify team of delivery submission (always) + flag restricted changes
          const notifyFields = safeChangedRestricted.length > 0
            ? safeChangedRestricted
            : ['Delivery Details'];
          // Restricted fields always alert (they need Summit's confirmation);
          // otherwise only a change to an already-completed Delivery tab does.
          if (safeChangedRestricted.length > 0 || order.progress?.delivery === PORTAL_DONE_LABEL) {
            await notifyTeamContactChange(order.name, actor, notifyFields).catch(console.error);
          }
        }

        const deliverySynced = await markSectionCompleteSafe(order.id, 'portalDelivery');

        return res.status(200).json({ ok: true, requiresConfirmation: safeChangedRestricted.length > 0, checklistSyncPending: !deliverySynced });
      }

      // AUDIT-2026-10-06: the legacy 'freight_ack' tab was removed. It
      // marked Delivery ✅ complete with no delivery details at all (just a
      // name + date), and nothing has called it since PORTAL-018 folded the
      // acknowledgment into the 'delivery' submission above (repo-wide grep
      // for 'freight_ack' on 2026-10-06: only this file). A stray request
      // now falls through to the default "Unknown tab" 400 below.

      // ── Tab 4: Color Selections ─────────────────────────────────────────
      case 'color': {
        await audit(order.id, 'PORTAL: Color Selections',
          `Customer marked color and product selections complete on ${new Date().toLocaleDateString()}.`
        );
        const colorSynced = await markSectionCompleteSafe(order.id, 'portalColors');
        return res.status(200).json({ ok: true, checklistSyncPending: !colorSynced });
      }

      // ── Invoice & Payment: Tax Exemption ─────────────────────────────────
      case 'tax_exemption': {
        const { taxExempt } = data;

        // AUDIT-2026-10-06: the "Tax Exempt" status column (COLS.taxExemptStatus)
        // is staff-managed (lib/monday.js) — staff set it once a certificate
        // is verified — but this used to overwrite it unconditionally, so a
        // customer clicking "No" (or a stale tab, or a direct POST) could
        // silently flip a verified "Yes" back to "No" and sales tax would
        // reappear on the invoice. Rule chosen:
        //   - "No"  is written only while the column is blank or already
        //     "No". Over a "Yes" (or any other staff-set label) it's refused
        //     with a 409 — TaxExemptionCard (pages/portal/index.js) already
        //     hides the "No" button once "Yes" is on file, so this only
        //     fires for stale/direct requests, and the customer is told to
        //     contact us instead.
        //   - "Yes" (certificate upload) is written over blank/"No"/"Yes";
        //     any OTHER staff-set label is left exactly as staff set it —
        //     the new certificate and the audit update still land for review.
        const currentStatus = (order.taxExemptStatus || '').trim();
        const statusIsCustomerWritable = !currentStatus
          || currentStatus === TAX_EXEMPT_NO_LABEL
          || currentStatus === TAX_EXEMPT_YES_LABEL;

        // "No" — record it and stop. No certificate requested; sales tax applies.
        if (!taxExempt) {
          if (currentStatus && currentStatus !== TAX_EXEMPT_NO_LABEL) {
            return res.status(409).json({
              error: 'Your tax-exempt status is already on file for this order. Please contact Summit Sensory Gym if it needs to change.',
              code: 'TAX_STATUS_LOCKED',
            });
          }
          await setStatusLabel(order.id, 'taxExemptStatus', TAX_EXEMPT_NO_LABEL);
          await audit(order.id, 'PORTAL: Tax Exempt - No',
            `Customer indicated they are NOT tax-exempt on ${new Date().toLocaleDateString()}. Sales tax applies to this order.`
          );
          return res.status(200).json({ ok: true });
        }

        // "Yes" — a valid certificate file is required.
        const upload = validateTaxCertUpload(data);
        if (upload.error) return res.status(upload.status).json({ error: upload.error });

        await uploadFileToColumn(order.id, COLS.taxExemptCertFile, upload.buffer, upload.fileName, upload.mimeType);
        if (statusIsCustomerWritable) {
          await setStatusLabel(order.id, 'taxExemptStatus', TAX_EXEMPT_YES_LABEL);
        }
        await audit(order.id, 'PORTAL: Tax Exemption Certificate Uploaded',
          `Customer uploaded a tax exemption certificate (${upload.fileName}) on ${new Date().toLocaleDateString()}.${statusIsCustomerWritable ? '' : ` Tax Exempt status left as staff set it ("${currentStatus}").`}`
        );
        await notifyTeamFormCompleted(order.name, actor, 'Tax Exemption Certificate').catch(console.error);

        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: `Unknown tab: ${tab}` });
    }
  } catch (err) {
    console.error('Setup save error:', err);
    return res.status(500).json({ error: 'Failed to save. Please try again.' });
  }
}
