/**
 * POST /api/portal/setup
 * Saves customer account setup data for a given tab.
 * Body: { tab, data }
 *
 * Tabs handled:
 *   contact         — confirmation only (data lives in Monday mirrors)
 *   billing         — stores billing address + POC as a tagged Monday update
 *   delivery        — saves editable fields + freight acknowledgment
 *   freight_ack     — records signed freight acknowledgment as Monday update
 *   tax_exemption   — Yes/No status (color_mm55tjn2) + certificate upload (file_mm55t6kn)
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import {
  getOrderById,
  updateOrderColumn,
  postTaggedUpdate,
  markSectionCompleteSafe,
  createDeliverySubmissionItem,
  setStatusLabel,
  uploadFileToColumn,
  COLS,
  STATUS_STAGES,
  TAX_EXEMPT_YES_LABEL,
  TAX_EXEMPT_NO_LABEL,
} from '../../../lib/monday';
import { allowRequest } from '../../../lib/rateLimit';

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

// Fields that require Summit confirmation when changed
const RESTRICTED_FIELDS = ['deliveryAddress', 'liftgate', 'loadingDock', 'deliveryWindow'];

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
              hasSecondaryPoc, secondaryPocName, secondaryPocPhone } = data;
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
      }
      if (hasSecondaryPoc) {
        if (isBlank(secondaryPocName)) return 'A secondary contact name is required when a secondary contact is enabled.';
        if (isBlank(secondaryPocPhone)) return 'A secondary contact phone is required when a secondary contact is enabled.';
      }
      return null;
    }
    case 'freight_ack': {
      const { acknowledgedBy, acknowledgedAt } = data;
      if (isBlank(acknowledgedBy)) return 'A name is required to acknowledge freight delivery requirements.';
      if (isBlank(acknowledgedAt)) return 'An acknowledgment date is required.';
      return null;
    }
    // 'contact' and 'color'/'documents' completion markers carry no
    // customer-entered fields to validate; 'tax_exemption' already checks
    // its own required fields (fileBase64/fileName) inline below.
    default:
      return null;
  }
}

// Tax exemption certificate uploads arrive as base64 in the JSON body — raise
// the default 1mb Next.js body limit so scanned PDFs/photos aren't rejected.
export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  // PORTAL-027: most tabs here trigger a team-notification email on every
  // save. See lib/rateLimit.js for the in-memory limiter's scope/limitations.
  if (!allowRequest(`portal-setup:${session.email}`, { maxRequests: 20, windowMs: 60_000 })) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { tab, data } = req.body || {};
  if (!tab || !data) return res.status(400).json({ error: 'tab and data required.' });

  const validationError = validateSetupData(tab, data);
  if (validationError) return res.status(400).json({ error: validationError });

  let order;
  try {
    order = await getOrderById(session.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load order.' });
  }

  try {
    switch (tab) {

      // ── Tab 1: Contact — confirmation only ──────────────────────────────
      case 'contact': {
        await postTaggedUpdate(order.id, 'PORTAL: Contact Confirmed',
          `Customer confirmed contact information on ${new Date().toLocaleDateString()}.`
        );
        await notifyTeamContactChange(order.name, session.email, ['Contact Information Confirmed']).catch(console.error);
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
        await postTaggedUpdate(order.id, 'PORTAL: Contact Update Requested', lines.join('\n'));
        await notifyTeamContactChange(
          order.name,
          session.email,
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

        await postTaggedUpdate(order.id, 'PORTAL: Billing Information',
          `Billing Address: ${addressText}\nBilling Contact: ${contactText}\nSubmitted: ${new Date().toLocaleDateString()}`
        );
        await notifyTeamContactChange(order.name, session.email, ['Billing Information']).catch(console.error);
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

        // Save the confirmed/updated ship-to address on the order record if the
        // customer entered a new one (long-text "Confirmed Delivery Address" column).
        // Monday's long_text columns require the complex value wrapped as
        // {text: "..."} — a bare string throws "invalid value" (confirmed
        // 2026-07-28 via a live GraphQL error on this exact call).
        if (addressConfirmed === false && formattedAddress) {
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

        await postTaggedUpdate(order.id, 'PORTAL: Delivery Details', lines.join('\n'));

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
        // separate 'freight_ack' case below is kept only for backward
        // compatibility with any in-flight requests from an older
        // deployed frontend.
        if (freightAckBy && freightAckDate) {
          await postTaggedUpdate(order.id, 'PORTAL: Freight Delivery Acknowledgment',
            `Acknowledged by: ${freightAckBy}\nDate: ${freightAckDate}\nCustomer has read and agreed to all freight delivery requirements.`
          );
        }

        // Push the full structured submission to the standalone Delivery &
        // Site Details Submissions board in Monday (one row per submission)
        await createDeliverySubmissionItem(order, {
          customerEmail: session.email,
          pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
          hasSecondaryPoc, secondaryPocName, secondaryPocPhone, secondaryPhoneCanText, secondaryPocEmail,
          primaryCommMethods, primaryMobilePhone,
          secondaryCommMethods, secondaryMobilePhone,
          addressConfirmed, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
          formattedAddress,
          loadingDock, deliveryTiming, preferredDeliveryDate,
          changedRestricted,
          freightAckBy, freightAckDate,
        }).catch(err => console.error('createDeliverySubmissionItem failed:', err));

        // Notify team of delivery submission (always) + flag restricted changes
        const notifyFields = changedRestricted?.length > 0
          ? changedRestricted
          : ['Delivery Details'];
        await notifyTeamContactChange(order.name, session.email, notifyFields).catch(console.error);
        const deliverySynced = await markSectionCompleteSafe(order.id, 'portalDelivery');

        return res.status(200).json({ ok: true, requiresConfirmation: changedRestricted?.length > 0, checklistSyncPending: !deliverySynced });
      }

      // ── Freight Acknowledgment ──────────────────────────────────────────
      case 'freight_ack': {
        // PORTAL-017: same server-side shipped-stage gate as 'delivery' above.
        if (isOrderShipped(order)) {
          return res.status(409).json({ error: 'This order has already shipped — the freight acknowledgment can no longer be submitted through the portal.' });
        }
        const { acknowledgedBy, acknowledgedAt } = data;
        await postTaggedUpdate(order.id, 'PORTAL: Freight Delivery Acknowledgment',
          `Acknowledged by: ${acknowledgedBy}\nDate: ${acknowledgedAt}\nCustomer has read and agreed to all freight delivery requirements.`
        );
        const freightAckSynced = await markSectionCompleteSafe(order.id, 'portalDelivery');
        return res.status(200).json({ ok: true, checklistSyncPending: !freightAckSynced });
      }

      // ── Tab 4: Color Selections ─────────────────────────────────────────
      case 'color': {
        await postTaggedUpdate(order.id, 'PORTAL: Color Selections',
          `Customer marked color and product selections complete on ${new Date().toLocaleDateString()}.`
        );
        const colorSynced = await markSectionCompleteSafe(order.id, 'portalColors');
        return res.status(200).json({ ok: true, checklistSyncPending: !colorSynced });
      }

      // ── Tab 5: Required Documents ───────────────────────────────────────
      case 'documents': {
        await postTaggedUpdate(order.id, 'PORTAL: Documents Submitted',
          `Customer marked required documents complete on ${new Date().toLocaleDateString()}.`
        );
        const documentsSynced = await markSectionCompleteSafe(order.id, 'portalDocuments');
        return res.status(200).json({ ok: true, checklistSyncPending: !documentsSynced });
      }

      // ── Invoice & Payment: Tax Exemption ─────────────────────────────────
      case 'tax_exemption': {
        const { taxExempt, fileBase64, fileName, mimeType } = data;

        // "No" — record it and stop. No certificate requested; sales tax applies.
        if (!taxExempt) {
          await setStatusLabel(order.id, 'taxExemptStatus', TAX_EXEMPT_NO_LABEL);
          await postTaggedUpdate(order.id, 'PORTAL: Tax Exempt - No',
            `Customer indicated they are NOT tax-exempt on ${new Date().toLocaleDateString()}. Sales tax applies to this order.`
          );
          return res.status(200).json({ ok: true });
        }

        // "Yes" — a certificate file is required.
        if (!fileBase64 || !fileName) {
          return res.status(400).json({ error: 'Please upload your tax exemption certificate.' });
        }

        const buffer = Buffer.from(fileBase64, 'base64');
        await uploadFileToColumn(order.id, COLS.taxExemptCertFile, buffer, fileName, mimeType);
        await setStatusLabel(order.id, 'taxExemptStatus', TAX_EXEMPT_YES_LABEL);
        await postTaggedUpdate(order.id, 'PORTAL: Tax Exemption Certificate Uploaded',
          `Customer uploaded a tax exemption certificate (${fileName}) on ${new Date().toLocaleDateString()}.`
        );
        await notifyTeamFormCompleted(order.name, session.email, 'Tax Exemption Certificate').catch(console.error);

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
