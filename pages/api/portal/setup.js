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
        return res.status(200).json({ ok: true });
      }

      // ── Tab 2: Billing ──────────────────────────────────────────────────
      case 'billing': {
        const {
          billingSameAsDelivery,
          billingAddress, billingCity, billingState, billingZip,
          billingContactSameAsPrimary,
          billingName, billingPhone, billingEmail,
        } = data;

        const addressText = billingSameAsDelivery
          ? `Same as delivery address`
          : `${billingAddress}, ${billingCity}, ${billingState} ${billingZip}`;

        const contactText = billingContactSameAsPrimary
          ? `Same as primary contact`
          : `${billingName} | ${billingPhone} | ${billingEmail}`;

        await postTaggedUpdate(order.id, 'PORTAL: Billing Information',
          `Billing Address: ${addressText}\nBilling Contact: ${contactText}\nSubmitted: ${new Date().toLocaleDateString()}`
        );
        return res.status(200).json({ ok: true });
      }

      // ── Tab 3: Delivery ─────────────────────────────────────────────────
      case 'delivery': {
        const {
          // Freely editable
          pocName, pocPhone, pocEmail, specialInstructions,
          // Restricted — require Summit confirmation
          deliveryAddress, liftgate, loadingDock, deliveryWindow,
          changedRestricted,
        } = data;

        // Save delivery address if provided and writable
        if (deliveryAddress) {
          await updateOrderColumn(order.id, COLS.address, deliveryAddress);
        }

        // Log the full delivery submission as a tagged update
        const lines = [
          `Delivery POC: ${pocName || '—'} | ${pocPhone || '—'} | ${pocEmail || '—'}`,
          `Special Instructions: ${specialInstructions || 'None'}`,
          deliveryAddress ? `Delivery Address: ${deliveryAddress}` : null,
          liftgate !== undefined ? `Liftgate Required: ${liftgate ? 'Yes' : 'No'}` : null,
          loadingDock !== undefined ? `Loading Dock Available: ${loadingDock ? 'Yes' : 'No'}` : null,
          deliveryWindow ? `Preferred Delivery Window: ${deliveryWindow}` : null,
          `Submitted: ${new Date().toLocaleDateString()}`,
        ].filter(Boolean);

        await postTaggedUpdate(order.id, 'PORTAL: Delivery Details', lines.join('\n'));

        // Alert team if restricted fields changed
        if (changedRestricted?.length > 0) {
          await notifyTeamContactChange(
            order.name,
            session.email,
            changedRestricted
          ).catch(console.error);
        }

        return res.status(200).json({ ok: true, requiresConfirmation: changedRestricted?.length > 0 });
      }

      // ── Freight Acknowledgment ──────────────────────────────────────────
      case 'freight_ack': {
        const { acknowledgedBy, acknowledgedAt } = data;
        await postTaggedUpdate(order.id, 'PORTAL: Freight Delivery Acknowledgment',
          `Acknowledged by: ${acknowledgedBy}\nDate: ${acknowledgedAt}\nCustomer has read and agreed to all freight delivery requirements.`
        );
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
