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
 *   {"formId": {"name": "Site Assessment", "checklistIndex": 1, "tab": "documents"}}
 *   "tab" may be "color" / "color_selection", "showcase", or omitted (defaults
 *   to the Documents checklist).
 */

import { getOrderByEmail, postTaggedUpdate, markSectionComplete, attachUgcFile, incrementUgcCounts } from '../../../lib/monday';
import { notifyTeamFormCompleted, notifyTeamUgcThreshold } from '../../../lib/email';

// Parse the form→checklist map from env
function getFormMap() {
  try {
    return JSON.parse(process.env.JOTFORM_FORM_MAP || '{}');
  } catch {
    return {};
  }
}

const IMAGE_EXT = /\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|webm|mkv|wmv|3gp|quicktime)(\?|$)/i;

/**
 * Jotform's rawRequest is pre-parsed JSON, but file-upload field answers can
 * arrive as: a single URL string, a JSON-stringified array of URL strings
 * (Jotform's most common file-upload format), a real array, or wrapped in
 * {answer: ...}. Rather than depend on Jotform's internal field key names
 * (which would require inspecting the form after Bryan builds it), scan every
 * value for URL-like strings and classify each by file extension.
 */
function extractShowcaseFiles(data) {
  const photos = [];
  const videos = [];

  const classify = (url) => {
    if (typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed.startsWith('http')) return;
    if (IMAGE_EXT.test(trimmed)) photos.push(trimmed);
    else if (VIDEO_EXT.test(trimmed)) videos.push(trimmed);
  };

  const visit = (val) => {
    if (val == null) return;
    if (typeof val === 'string') {
      const s = val.trim();
      // JSON-stringified array of URLs — Jotform's typical file-upload format
      if (s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) { parsed.forEach(visit); return; }
        } catch { /* not JSON — fall through and treat as a plain string */ }
      }
      classify(s);
      return;
    }
    if (Array.isArray(val)) { val.forEach(visit); return; }
    if (typeof val === 'object') {
      if (val.answer !== undefined) { visit(val.answer); return; }
      // Some Jotform formats nest file arrays under { url: [...] } or similar
      Object.values(val).forEach(visit);
    }
  };

  Object.values(data || {}).forEach(visit);

  // De-dupe in case a URL got scanned twice via nested structures
  return { photos: [...new Set(photos)], videos: [...new Set(videos)] };
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

  // Dispatch by form type — color selections, required documents, or the
  // repeatable Photo & Video Showcase (not a one-time checklist item).
  const tabType = formConfig.tab === 'color' || formConfig.tab === 'color_selection'
    ? 'color'
    : formConfig.tab === 'showcase'
      ? 'showcase'
      : 'documents';

  if (tabType === 'showcase') {
    const { photos, videos } = extractShowcaseFiles(submissionData);

    for (const url of photos) {
      await attachUgcFile(order.id, url, 'photo').catch(err => console.error('attachUgcFile (photo) failed:', err.message));
    }
    for (const url of videos) {
      await attachUgcFile(order.id, url, 'video').catch(err => console.error('attachUgcFile (video) failed:', err.message));
    }

    await postTaggedUpdate(
      order.id,
      'PORTAL: Photo/Video Submitted',
      `Customer submitted ${photos.length} photo(s) and ${videos.length} video(s) via the Photo & Video Showcase form on ${new Date().toLocaleDateString()}. Submitted by: ${email}`
    ).catch(console.error);

    const result = await incrementUgcCounts(order.id, photos.length, videos.length)
      .catch(err => { console.error('incrementUgcCounts failed:', err.message); return null; });

    if (result?.crossedNewTier) {
      await notifyTeamUgcThreshold(order.name, email, result.photoCount, result.videoCount, result.credits).catch(console.error);
    }

    return res.status(200).json({ ok: true, orderName: order.name, form: formConfig.name, photos: photos.length, videos: videos.length });
  }

  // Record completion in Monday.com as a tagged update so the cron can detect it
  const isColor = tabType === 'color';
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
