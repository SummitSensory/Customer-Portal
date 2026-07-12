/**
 * POST /api/jotform/webhook
 * Receives Jotform submission webhooks, matches to a Monday.com order,
 * and marks the corresponding checklist item as complete.
 *
 * Setup: In Jotform → Settings → Integrations → Webhooks, add:
 *   https://your-domain.vercel.app/api/jotform/webhook
 *
 * The webhook secret (JOTFORM_WEBHOOK_SECRET) is used to verify requests.
 * Form-to-checklist mapping is read from JOTFORM_FORM_MAP (JSON env var):
 *   {"formId": {"name": "Site Assessment", "checklistIndex": 1}}
 */

import { getOrderByEmail, postTaggedUpdate, markSectionComplete } from '../../../lib/monday';
import { notifyTeamFormCompleted } from '../../../lib/email';

// Parse the form→checklist map from env
function getFormMap() {
  try {
    return JSON.parse(process.env.JOTFORM_FORM_MAP || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Optional: verify the secret header Jotform can send
  const secret = req.headers['x-jotform-secret'] || req.body?.secret;
  if (process.env.JOTFORM_WEBHOOK_SECRET && secret !== process.env.JOTFORM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  const { formID, rawRequest } = req.body || {};
  if (!formID) return res.status(400).json({ error: 'formID required.' });

  // Parse the submission data
  let submissionData = {};
  try {
    submissionData = typeof rawRequest === 'string'
      ? JSON.parse(rawRequest)
      : rawRequest || {};
  } catch {
    submissionData = {};
  }

  // Extract customer email from the submission
  // Jotform sends field values as q{N}_email, q{N}_email3, etc.
  const email = extractEmail(submissionData);
  if (!email) {
    console.error('Jotform webhook: no email found in submission', formID);
    return res.status(200).json({ ok: true, note: 'No email found — skipped.' });
  }

  // Look up the form mapping
  const formMap = getFormMap();
  const formConfig = formMap[formID];
  if (!formConfig) {
    console.warn('Jotform webhook: no mapping for formID', formID);
    return res.status(200).json({ ok: true, note: 'No mapping for this form.' });
  }

  // Find the order
  let order;
  try {
    order = await getOrderByEmail(email.toLowerCase());
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Failed to look up order.' });
  }

  if (!order) {
    console.warn('Jotform webhook: no order for email', email);
    return res.status(200).json({ ok: true, note: 'No order found for email.' });
  }

  // Record completion in Monday.com as a tagged update so the cron can detect it
  const isColor = formConfig.tab === 'color' || formConfig.tab === 'color_selection';
  const tag = isColor ? 'PORTAL: Color Selections' : 'PORTAL: Documents Submitted';

  await postTaggedUpdate(
    order.id,
    tag,
    `Jotform submission received for "${formConfig.name}" on ${new Date().toLocaleDateString()}. Submitted by: ${email}`
  ).catch(console.error);

  // Flip the matching portal checklist column (Portal: Color Selections / Portal: Documents) to ✅
  await markSectionComplete(order.id, isColor ? 'portalColors' : 'portalDocuments').catch(console.error);

  // Notify team
  await notifyTeamFormCompleted(order.name, email, formConfig.name).catch(console.error);

  return res.status(200).json({ ok: true, orderName: order.name, form: formConfig.name });
}

function extractEmail(data) {
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
      return val;
    }
    if (typeof val === 'object' && val?.answer) {
      if (typeof val.answer === 'string' && val.answer.includes('@')) return val.answer;
    }
  }
  return null;
}

// Disable Next.js body parsing so we get the raw form data
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
