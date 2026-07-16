/**
 * POST /api/portal/setup
 * Saves customer account setup data for a given tab.
 * Body: { tab, data }
 *
 * Tabs handled:
 *   contact      — confirmation only (data lives in Monday mirrors)
 *   billing      — stores billing address + POC as a tagged Monday update
 *   delivery     — saves editable fields + freight acknowledgment
 *   freight_ack  — records signed freight acknowledgment as Monday update
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import {
  getOrderById,
  updateOrderColumn,
  postTaggedUpdate,
  markSectionComplete,
  createDeliverySubmissionItem,
  COLS,
} from '../../../lib/monday';
import { notifyTeamContactChange } from '../../../lib/email';

// Fields that require Summit confirmation when changed
const RESTRICTED_FIELDS = ['deliveryAddress', 'liftgate', 'loadingDock', 'deliveryWindow'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookies = parse(req.headers.cookie || '');
  const session = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { tab, data } = req.body || {};
  if (!tab || !data) return res.status(400).json({ error: 'tab and data required.' });

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
        await markSectionComplete(order.id, 'portalContact').catch(console.error);
        return res.status(200).json({ ok: true });
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
        await markSectionComplete(order.id, 'portalContact').catch(console.error);
        return res.status(200).json({ ok: true });
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
        await updateOrderColumn(order.id, COLS.billingAddressConfirmed, addressText);

        await postTaggedUpdate(order.id, 'PORTAL: Billing Information',
          `Billing Address: ${addressText}\nBilling Contact: ${contactText}\nSubmitted: ${new Date().toLocaleDateString()}`
        );
        await notifyTeamContactChange(order.name, session.email, ['Billing Information']).catch(console.error);
        await markSectionComplete(order.id, 'portalBilling').catch(console.error);
        return res.status(200).json({ ok: true });
      }

      // ── Tab 3: Delivery ─────────────────────────────────────────────────
      case 'delivery': {
        const {
          pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
          hasSecondaryPoc, secondaryPocName, secondaryPocPhone, secondaryPhoneCanText, secondaryPocEmail,
          primaryCommMethods, primaryMobilePhone,
          secondaryCommMethods, secondaryMobilePhone,
          addressConfirmed, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
          formattedAddress,
          loadingDock, deliveryTiming, preferredDeliveryDate,
          changedRestricted,
          freightAckBy, freightAckDate,
        } = data;

        // Save the confirmed/updated ship-to address on the order record if the
        // customer entered a new one (long-text "Confirmed Delivery Address" column)
        if (addressConfirmed === false && formattedAddress) {
          await updateOrderColumn(order.id, COLS.address, formattedAddress);
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
        await markSectionComplete(order.id, 'portalDelivery').catch(console.error);

        return res.status(200).json({ ok: true, requiresConfirmation: changedRestricted?.length > 0 });
      }

      // ── Freight Acknowledgment ──────────────────────────────────────────
      case 'freight_ack': {
        const { acknowledgedBy, acknowledgedAt } = data;
        await postTaggedUpdate(order.id, 'PORTAL: Freight Delivery Acknowledgment',
          `Acknowledged by: ${acknowledgedBy}\nDate: ${acknowledgedAt}\nCustomer has read and agreed to all freight delivery requirements.`
        );
        await markSectionComplete(order.id, 'portalDelivery').catch(console.error);
        return res.status(200).json({ ok: true });
      }

      // ── Tab 4: Color Selections ─────────────────────────────────────────
      case 'color': {
        await postTaggedUpdate(order.id, 'PORTAL: Color Selections',
          `Customer marked color and product selections complete on ${new Date().toLocaleDateString()}.`
        );
        await markSectionComplete(order.id, 'portalColors').catch(console.error);
        return res.status(200).json({ ok: true });
      }

      // ── Tab 5: Required Documents ───────────────────────────────────────
      case 'documents': {
        await postTaggedUpdate(order.id, 'PORTAL: Documents Submitted',
          `Customer marked required documents complete on ${new Date().toLocaleDateString()}.`
        );
        await markSectionComplete(order.id, 'portalDocuments').catch(console.error);
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
