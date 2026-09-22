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

import { getOrdersByEmail, getOrderMessages, postTaggedUpdate, markSectionCompleteSafe, attachUgcFile, incrementUgcCounts } from '../../../lib/monday';
import { notifyTeamFormCompleted, notifyTeamUgcThreshold } from '../../../lib/email';
import { secretsMatch } from '../../../lib/auth';
import { reportCriticalFailure } from '../../../lib/monitoring';

// Parse the form→checklist map from env
function getFormMap() {
  try {
    return JSON.parse(process.env.JOTFORM_FORM_MAP || '{}');
  } catch {
    return {};
  }
}

/** Resolve a form's configured "tab" string to the actual tabType used below. */
function resolveTabType(formConfig) {
  return formConfig.tab === 'color' || formConfig.tab === 'color_selection'
    ? 'color'
    : formConfig.tab === 'showcase'
      ? 'showcase'
      : 'documents';
}

/**
 * Every formID in JOTFORM_FORM_MAP that resolves to the same tabType AND
 * applies to this order's product type. Used so a tab backed by multiple
 * Jotform forms (e.g. several Required Documents forms, or several
 * product-specific Color Selection forms) only reports complete once every
 * form that's actually applicable to THIS order has been submitted, instead
 * of flipping ✅ the instant any single one arrives — or, conversely,
 * never flipping because it also demands forms scoped to OTHER product
 * types that this order could never submit.
 *
 * Mirrors the frontend's productForms filter in pages/portal/index.js
 * (a form with no productTypes applies to every order; a form with
 * productTypes only applies when it includes this order's productType).
 */
function formsForTab(formMap, tabType, productType) {
  return Object.keys(formMap).filter((id) => {
    const cfg = formMap[id];
    if (resolveTabType(cfg) !== tabType) return false;
    return !cfg.productTypes || cfg.productTypes.includes(productType);
  });
}

/**
 * The tagged-update title used to record a completed submission for a
 * "documents" or "color" tab — shared by the completeness check below and
 * the actual audit-trail update posted further down in the handler, so the
 * two can never drift out of sync with each other.
 */
function submissionTagFor(tabType) {
  return tabType === 'color' ? 'PORTAL: Color Selections' : 'PORTAL: Documents Submitted';
}

/**
 * PORTAL-025 (2026-09-21): getOrderByEmail() (now removed) deterministically
 * resolved to the customer's SINGLE MOST RECENT order, with no order-scoping
 * signal available anywhere in the request — the embedded Jotform iframe
 * passes no orderId, and there's no external Jotform config change available
 * from this codebase alone to add one. For a repeat customer with 2+ active
 * orders, a submission meant for an OLDER order (the one actually still
 * missing it) silently got attached to whichever order happened to be
 * newest instead.
 *
 * Best fix available: among the customer's orders (already sorted
 * newest-first by getOrdersByEmail), walk oldest-to-newest and prefer the
 * first one whose tabType checklist is NOT YET fully submitted — i.e. the
 * order this submission is actually most likely completing — falling back
 * to the newest order when every order already has this tab's forms in, an
 * order's product type doesn't require this tab at all, or there's only one
 * order to begin with. Reuses formsForTab() and the exact same "every
 * required form has a `(form:id)`-tagged update" completeness definition
 * the tabComplete check further down the handler already relies on for the
 * single resolved order, so "complete" means the same thing in both places.
 *
 * Showcase is deliberately excluded (falls straight through to the newest
 * order, matching the pre-existing behavior): it's a repeatable UGC tab
 * with no completion state at all — no checklist column ever gets flipped,
 * and (see the showcase branch below) its tagged updates don't carry a
 * `(form:id)` marker to check against. Treating "no completion signal" as
 * "never complete" would route every SUBSEQUENT showcase submission from a
 * repeat customer onto an older, unrelated order instead of the one they're
 * actively adding photos/videos to — strictly worse than the bug this is
 * fixing, so showcase keeps the original most-recent-order behavior.
 */
async function resolveOrderForSubmission(email, formMap, tabType) {
  const orders = await getOrdersByEmail(email); // sorted newest → oldest
  if (orders.length <= 1 || tabType === 'showcase') return orders[0] || null;

  const tag = submissionTagFor(tabType);
  const oldestFirst = [...orders].reverse();
  for (const candidate of oldestFirst) {
    const requiredFormIds = formsForTab(formMap, tabType, candidate.productType);
    if (requiredFormIds.length === 0) continue; // this tab doesn't apply to this order's product type at all

    let bodies;
    try {
      const updates = await getOrderMessages(candidate.id);
      bodies = updates.map((u) => u.body || '');
    } catch (err) {
      // Can't verify this candidate's completeness — rather than guess (and
      // risk silently misrouting the submission), fall back to the
      // previously-known-good default of the most recent order.
      console.error('Jotform webhook: failed to check tab completeness for order', candidate.id, err.message);
      return orders[0];
    }

    const complete = requiredFormIds.every((id) =>
      bodies.some((b) => b.includes(tag) && b.includes(`(form:${id})`))
    );
    if (!complete) return candidate;
  }

  // Every order either already has this tab's forms in, or doesn't require
  // this tab at all — default to the newest order.
  return orders[0];
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

  // Verify the shared secret Jotform sends back (as a custom header configured
  // in Jotform's webhook settings, or the "secret" field in the payload).
  // PORTAL-011: this previously skipped verification entirely whenever
  // JOTFORM_WEBHOOK_SECRET was unset, letting anyone who found this URL post
  // fabricated submissions (including attacker-controlled file URLs — see
  // PORTAL-006) as if they came from a real Jotform. Fails CLOSED now.
  const configuredSecret = process.env.JOTFORM_WEBHOOK_SECRET;
  const secret = req.headers['x-jotform-secret'] || req.body?.secret;
  if (!secretsMatch(secret, configuredSecret)) {
    console.error('Jotform webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  // PORTAL-013: Jotform (and Monday, generically) can legitimately redeliver
  // a webhook on a timeout or non-200 response. submissionID uniquely
  // identifies one Jotform submission — when present, it's used below to
  // recognize and skip a redelivery instead of double-attaching UGC files
  // or double-crediting the reward tally.
  const { formID, rawRequest, submissionID } = req.body || {};
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

  // Dispatch by form type — color selections, required documents, or the
  // repeatable Photo & Video Showcase (not a one-time checklist item).
  // Resolved before the order lookup now (see resolveOrderForSubmission's
  // header comment) since PORTAL-025's multi-order resolution needs to know
  // which checklist to check completeness against.
  const tabType = resolveTabType(formConfig);

  // Find the order. PORTAL-025: no longer just "the customer's most recent
  // order" — see resolveOrderForSubmission above for why.
  let order;
  try {
    order = await resolveOrderForSubmission(email.toLowerCase(), formMap, tabType);
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Failed to look up order.' });
  }

  if (!order) {
    console.warn('Jotform webhook: no order for email', email);
    return res.status(200).json({ ok: true, note: 'No order found for email.' });
  }

  // PORTAL-013: skip a redelivery of a submission we've already recorded.
  // Marker is embedded in the tagged update posted below (both the showcase
  // and the standard-tab paths), so this only works going forward for
  // submissions processed after this fix — acceptable, since the goal is
  // to stop future double-processing, not retroactively audit past ones.
  if (submissionID) {
    try {
      const priorUpdates = await getOrderMessages(order.id);
      const alreadyProcessed = priorUpdates.some((u) => (u.body || '').includes(`(submission:${submissionID})`));
      if (alreadyProcessed) {
        return res.status(200).json({ ok: true, duplicate: true, note: 'Submission already processed.' });
      }
    } catch (err) {
      // Non-fatal — if the dedupe check itself fails, proceed rather than
      // block a legitimate submission over it.
      console.error('Jotform webhook: dedupe check failed (continuing anyway):', err.message);
    }
  }
  const submissionTag = submissionID ? ` (submission:${submissionID})` : '';

  // tabType was already resolved above (needed for order resolution).
  if (tabType === 'showcase') {
    const { photos, videos } = extractShowcaseFiles(submissionData);

    // Track actual successes, not attempts — previously every attach was
    // fire-and-forget (errors only logged), so postTaggedUpdate/
    // incrementUgcCounts/notifyTeamUgcThreshold ran with the ORIGINAL
    // photos.length/videos.length even if every single attach had thrown,
    // recording a submission (and crediting toward the reward) that never
    // actually landed on the order.
    let photosOk = 0;
    let videosOk = 0;
    for (const url of photos) {
      const ok = await attachUgcFile(order.id, url, 'photo')
        .then(() => true)
        .catch(err => { console.error('attachUgcFile (photo) failed:', err.message); return false; });
      if (ok) photosOk++;
    }
    for (const url of videos) {
      const ok = await attachUgcFile(order.id, url, 'video')
        .then(() => true)
        .catch(err => { console.error('attachUgcFile (video) failed:', err.message); return false; });
      if (ok) videosOk++;
    }

    const attemptedTotal = photos.length + videos.length;
    if (attemptedTotal > 0 && photosOk === 0 && videosOk === 0) {
      // Every attach attempt failed — don't log a false "submitted" update
      // or credit the reward tally for files that were never attached.
      console.error(`Jotform webhook: all ${attemptedTotal} UGC attach attempt(s) failed for order ${order.id}.`);
      return res.status(502).json({ error: 'Failed to attach submitted photos/videos.' });
    }

    const partialFailureNote = (photosOk < photos.length || videosOk < videos.length)
      ? ` (${(photos.length - photosOk) + (videos.length - videosOk)} of ${attemptedTotal} file(s) failed to attach — check server logs.)`
      : '';

    await postTaggedUpdate(
      order.id,
      'PORTAL: Photo/Video Submitted',
      `Customer submitted ${photosOk} photo(s) and ${videosOk} video(s) via the Photo & Video Showcase form on ${new Date().toLocaleDateString()}.${partialFailureNote} Submitted by: ${email}${submissionTag}`
    ).catch(console.error);

    const result = await incrementUgcCounts(order.id, photosOk, videosOk)
      .catch(err => { console.error('incrementUgcCounts failed:', err.message); return null; });

    if (result?.crossedNewTier) {
      await notifyTeamUgcThreshold(order.name, email, result.photoCount, result.videoCount, result.credits, order.id).catch(console.error);
    }

    return res.status(200).json({
      ok: true,
      orderName: order.name,
      form: formConfig.name,
      photos: photosOk,
      videos: videosOk,
      photosAttempted: photos.length,
      videosAttempted: videos.length,
    });
  }

  // Record completion in Monday.com as a tagged update so the cron can detect it.
  // The form ID is embedded in the tag so a tab backed by multiple forms
  // (see formsForTab above) can be verified as fully complete rather than
  // flipped ✅ the instant any single one of its forms arrives — previously
  // ANY form mapped to "documents" (or "color") completed the whole tab,
  // even if the checklist had several required forms and only one had come in.
  const isColor = tabType === 'color';
  const tag = submissionTagFor(tabType);

  // PORTAL-025 (2026-09-21): this update IS the PORTAL-013 dedupe marker —
  // the `(submission:${submissionID})` string the dedupe check near the top
  // of this handler searches getOrderMessages() for on the NEXT delivery.
  // It also doubles as the `(form:${formID})` marker formsForTab's
  // completeness check (right below, and resolveOrderForSubmission above)
  // depends on. A bare `.catch(console.error)` here meant that if this
  // write failed, neither marker ever landed on the order — so a genuine
  // Jotform webhook retry of the SAME submission (which this file's own
  // PORTAL-013 comment already documents as expected/legitimate behavior
  // from Jotform, not a bug) would be fully reprocessed on the next
  // delivery: a second "form completed" email to staff via
  // notifyTeamFormCompleted below, and a tabComplete check run without the
  // record of the first attempt. Report it the same way every other
  // silent-failure class in this codebase is (PORTAL-014's
  // markSectionCompleteSafe, PORTAL-023's reportCriticalFailure) instead of
  // just logging it.
  await postTaggedUpdate(
    order.id,
    `${tag} (form:${formID})`,
    `Jotform submission received for "${formConfig.name}" on ${new Date().toLocaleDateString()}. Submitted by: ${email}${submissionTag}`
  ).catch(async (err) => {
    console.error('Jotform webhook: failed to post the completion/dedupe marker update:', err.message);
    await reportCriticalFailure(
      'jotform-webhook-dedupe-marker',
      `Failed to record the completion marker for order ${order.id} (form ${formID}${submissionID ? `, submission ${submissionID}` : ''}) — a Jotform retry of this submission may now be fully reprocessed as a duplicate (duplicate staff notification, and a tabComplete check missing this submission's record).`,
      { orderId: order.id, formID, submissionID: submissionID || null, error: err.message }
    );
  });

  const requiredFormIds = formsForTab(formMap, tabType, order.productType);
  let tabComplete = true;
  if (requiredFormIds.length > 1) {
    try {
      const updates = await getOrderMessages(order.id);
      const bodies = updates.map(u => u.body || '');
      tabComplete = requiredFormIds.every((id) =>
        id === formID || bodies.some((b) => b.includes(tag) && b.includes(`(form:${id})`))
      );
    } catch (err) {
      console.error('Jotform webhook: failed to check other forms mapped to this tab — marking complete based on this submission alone:', err.message);
    }
  }

  // Flip the matching portal checklist column (Portal: Color Selections / Portal: Documents)
  // to ✅ — only once every form mapped to this tab has been submitted.
  // PORTAL-014: retried and reported honestly instead of silently swallowed —
  // see markSectionCompleteSafe() in lib/monday.js.
  let checklistSynced = true;
  if (tabComplete) {
    checklistSynced = await markSectionCompleteSafe(order.id, isColor ? 'portalColors' : 'portalDocuments');
  }

  // Notify team
  await notifyTeamFormCompleted(order.name, email, formConfig.name).catch(console.error);

  return res.status(200).json({ ok: true, orderName: order.name, form: formConfig.name, tabComplete, checklistSyncPending: !checklistSynced });
}

// A real (if not fully RFC 5322) email-format check — the previous version
// only required a value to contain BOTH "@" and "." anywhere in the string,
// which could false-match on unrelated free-text fields (e.g. a notes field
// mentioning a file like "photo1.jpg" next to an "@" reference).
const EMAIL_RE = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/;

/**
 * Find the first email-shaped value anywhere in the submission, recursing
 * into nested objects/arrays the same way extractShowcaseFiles does — the
 * old version only checked top-level string values or a one-level-deep
 * {answer: "..."} shape, and would silently return null (routing the
 * submission nowhere, per the "no order found for email" branch above) for
 * any Jotform field shape nested any deeper than that.
 */
function extractEmail(data) {
  let found = null;

  const visit = (val) => {
    if (found || val == null) return;
    if (typeof val === 'string') {
      const match = val.trim().match(EMAIL_RE);
      if (match) found = match[0];
      return;
    }
    if (Array.isArray(val)) { val.forEach(visit); return; }
    if (typeof val === 'object') {
      Object.values(val).forEach(visit);
    }
  };

  Object.values(data || {}).forEach(visit);
  return found;
}

// Disable Next.js body parsing so we get the raw form data
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
