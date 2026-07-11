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
  markSectionComplete,
  setStatusLabel,
  uploadFileToColumn,
  COLS,
  TAX_EXEMPT_YES_LABEL,
  TAX_EXEMPT_NO_LABEL,
} from '../../../lib/monday';
import { notifyTeamContactChange, notifyTeamFormCompleted } from '../../../lib/email';

// Fields that require Summit confirmation when changed
const RESTRICTED_FIELDS = ['deliveryAddress', 'liftgate', 'loadingDock', 'deliveryWindow'];

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
          billingSameAsDelivery,
          billingAddress, billingAddressSuite, billingCity, billingState, billingZip, billingCountry,
          billingContactSameAsPrimary,
          billingName, billingPhone, billingEmail,
        } = data;

        let addressText = billingSameAsDelivery ? `Same as delivery address` : billingAddress;
        if (!billingSameAsDelivery) {
          if (billingAddressSuite) addressText += `, ${billingAddressSuite}`;
          addressText += `, ${billingCity}`;
          if (billingState) addressText += `, ${billingState}`;
          if (billingZip) addressText += ` ${billingZip}`;
          if (billingCountry) addressText += `, ${billingCountry}`;
        }

        const contactText = billingContactSameAsPrimary
          ? `Same as primary contact`
          : `${billingName} | ${billingPhone} | ${billingEmail}`;

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
          commMethods, mobilePhone,
          deliveryAddress, deliveryWindow,
          changedRestricted,
        } = data;

        // Save delivery address if provided and changed
        if (deliveryAddress) {
          await updateOrderColumn(order.id, COLS.address, deliveryAddress);
        }

        // Log the full delivery submission as a tagged update
        const phoneNote = phoneCanText ? ' (can text)' : '';
        const commNote = Array.isArray(commMethods) ? commMethods.join(', ') : (commMethods || 'Email');
        const lines = [
          `Delivery POC: ${pocName || '—'} | ${pocPhone || '—'}${phoneNote} | ${pocEmail || '—'}`,
          `Preferred Communication: ${commNote}${mobilePhone ? ` — Mobile: ${mobilePhone}` : ''}`,
          `Special Instructions: ${specialInstructions || 'None'}`,
          deliveryAddress ? `Delivery Address: ${deliveryAddress}` : null,
          deliveryWindow ? `Preferred Delivery Window: ${deliveryWindow}` : null,
          `Submitted: ${new Date().toLocaleDateString()}`,
        ].filter(Boolean);

        await postTaggedUpdate(order.id, 'PORTAL: Delivery Details', lines.join('\n'));

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
