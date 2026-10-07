/**
 * GET  /api/monday/files?orderId=...  — list files for an order (customer or admin)
 * POST /api/monday/files              — admin: upload a file URL to an order
 */

import { parse } from 'cookie';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getOrderFiles, addFileToOrder, getOrderById, orderIdBelongsToEmail, STAFF_UPLOAD_HOST_ALLOWLIST } from '../../../lib/monday';
import { ORDER_NOT_OWNED_ERROR } from '../../../lib/apiAuth';
import { notifyCustomerNewFile } from '../../../lib/email';

async function getIdentity(req, res) {
  const staffSession = await getServerSession(req, res, authOptions);
  if (staffSession) return { role: 'staff', email: staffSession.user.email };

  const cookies = parse(req.headers.cookie || '');
  const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  if (customerSession) return { role: 'customer', ...customerSession };

  return null;
}

export default async function handler(req, res) {
  const identity = await getIdentity(req, res);
  if (!identity) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method === 'GET') {
    const orderId = req.query.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId required.' });

    if (identity.role === 'customer' && String(orderId) !== String(identity.orderId)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    try {
      // AUDIT-2026-10-06: customers only see what staff put in the Portal
      // Files column — not every asset on the item (internal uploads, the
      // tax certificate, update attachments). See getOrderFiles().
      // AUDIT-2026-10-06 (follow-up): customer reads re-check that the order
      // still belongs to the session's email (same rule as
      // loadSessionOrder), via a one-column read run alongside the main one.
      const [files, owned] = await Promise.all([
        getOrderFiles(orderId, { portalFilesOnly: identity.role === 'customer' }),
        identity.role === 'customer' ? orderIdBelongsToEmail(orderId, identity.email) : true,
      ]);
      if (!owned) {
        return res.status(401).json({ error: ORDER_NOT_OWNED_ERROR, code: 'ORDER_NOT_OWNED' });
      }
      return res.status(200).json({ files });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load files.' });
    }
  }

  if (req.method === 'POST') {
    // Admin only
    if (identity.role !== 'staff') return res.status(403).json({ error: 'Forbidden.' });

    const { orderId, fileUrl, fileName } = req.body || {};
    if (!orderId || !fileUrl || !fileName) {
      return res.status(400).json({ error: 'orderId, fileUrl, and fileName required.' });
    }
    // PORTAL-049: defense in depth alongside lib/monday.js's uploadFileToColumn
    // fix — a real Monday item id is always purely numeric, so reject
    // anything else here rather than relying solely on that fix downstream.
    if (!/^\d+$/.test(String(orderId))) {
      return res.status(400).json({ error: 'Invalid orderId.' });
    }

    let file;
    try {
      // Staff-pasted links come from an authenticated admin session, not a
      // public form submission — use the wider staff allowlist (Jotform +
      // SharePoint/Google Drive/Dropbox/OneDrive) instead of the Jotform-only
      // one meant for the public webhook path. See lib/monday.js.
      file = await addFileToOrder(orderId, fileUrl, fileName, { allowlist: STAFF_UPLOAD_HOST_ALLOWLIST });
    } catch (err) {
      console.error('files POST: upload failed:', err.message);
      return res.status(500).json({ error: 'Failed to upload file.' });
    }

    // AUDIT-2026-10-06: the file is uploaded at this point. The order read
    // for the customer email used to share the upload's try block, so a
    // failed READ reported "Failed to upload file." for a file that WAS
    // uploaded — staff retried and the customer got it twice. Best-effort
    // now; a missed notification comes back as a warning instead.
    const warnings = [];
    try {
      const order = await getOrderById(orderId);
      if (order?.customerEmail) {
        await notifyCustomerNewFile(
          order.customerEmail, order.contactName, order.name, fileName
        ).catch((err) => {
          console.error(err);
          warnings.push('File uploaded, but emailing the customer about it failed.');
        });
      }
    } catch (err) {
      console.error(`files POST: file uploaded to order ${orderId}, but loading the order to notify the customer failed:`, err.message);
      warnings.push('File uploaded, but the customer could not be notified (order lookup failed).');
    }

    return res.status(201).json({ file, warnings });
  }

  return res.status(405).end();
}
