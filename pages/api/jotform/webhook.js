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

import { getOrdersByEmail, getOrderById, getOrderMessages, postTaggedUpdate, markSectionCompleteSafe, attachUgcFile, incrementUgcCounts } from '../../../lib/monday';
import { notifyTeamFormCompleted, notifyTeamUgcThreshold } from '../../../lib/email';
import * as auth from '../../../lib/auth';
import { reportCriticalFailure } from '../../../lib/monitoring';

const { secretsMatch } = auth;

// A showcase claim younger than this means another delivery of the same
// submission is still attaching files — skip instead of double-attaching.
const SHOWCASE_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * The order a signed `portal_order_token` hidden field points at, or null.
 * The webhook secret only proves a request came from Jotform, not who filled
 * the form in, and the forms are public — so matching purely on a typed-in
 * email let anyone mark a customer's tab complete or attach files to their
 * order (audit 2026-10-09). When the portal prefills this token (signed by
 * lib/auth.js's signFormOrderToken), it decides the order outright. Guarded
 * so this file still works while that helper isn't deployed yet.
 */
async function orderFromToken(data) {
  const token = findFieldValue(data, (key) => /portal_order_token/i.test(key));
  if (!token) return null;
  let verified = null;
  try {
    const verify = auth.verifyFormOrderToken;
    verified = typeof verify === 'function' ? await verify(String(token).trim()) : null;
  } catch {
    verified = null;
  }
  const orderId = typeof verified === 'string' ? verified : verified?.orderId;
  if (!orderId) {
    console.warn('Jotform webhook: portal_order_token present but invalid — falling back to email matching.');
    return null;
  }
  return getOrderById(String(orderId));
}

// Parse the form→checklist map from env. The Showcase and default Color
// Selection forms are already identified by their own env vars, so they're
// mapped automatically — JOTFORM_FORM_MAP was never set in production, which
// meant every submission was dropped as "No mapping for this form".
export function getFormMap() {
  let map = {};
  try {
    map = JSON.parse(process.env.JOTFORM_FORM_MAP || '{}');
  } catch {
    map = {};
  }
  const showcaseId = (process.env.JOTFORM_SHOWCASE_FORM_ID || '').trim();
  const colorId = (process.env.JOTFORM_COLOR_FORM_ID || '').trim();
  if (showcaseId && !map[showcaseId]) map[showcaseId] = { name: 'Photo & Video Showcase', tab: 'showcase' };
  if (colorId && !map[colorId]) map[colorId] = { name: 'Color Selection', tab: 'color' };
  return map;
}

/**
 * Jotform's native webhook POSTs multipart/form-data (formID, submissionID,
 * rawRequest, …). Next's body parser only understands JSON/urlencoded and
 * hands anything else over as a raw string, so formID was always missing and
 * every real delivery was rejected. Text fields only — Jotform doesn't put
 * files in the webhook body.
 */
export function parseMultipartFields(raw, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundary || typeof raw !== 'string') return {};
  const fields = {};
  for (const part of raw.split(`--${boundary[1] || boundary[2]}`)) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const name = /name="([^"]+)"/i.exec(part.slice(0, sep));
    if (!name) continue;
    fields[name[1]] = part.slice(sep + 4).replace(/\r\n$/, '');
  }
  return fields;
}

function requestFields(req) {
  if (typeof req.body === 'string' && /multipart\/form-data/i.test(req.headers['content-type'] || '')) {
    return parseMultipartFields(req.body, req.headers['content-type']);
  }
  return req.body || {};
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
  // Jotform's webhook settings can't add custom headers, so the secret
  // normally rides on the URL: /api/jotform/webhook?secret=…
  const body = requestFields(req);
  const configuredSecret = process.env.JOTFORM_WEBHOOK_SECRET;
  const secret = req.query?.secret || req.headers['x-jotform-secret'] || body.secret;
  if (!secretsMatch(secret, configuredSecret)) {
    // A wrong secret is just a stray/probing request: log it, don't email
    // (lib/errorAlerts.js emails every console.error). A MISSING secret
    // means every real delivery is failing, so that still alerts.
    (process.env.JOTFORM_WEBHOOK_SECRET ? console.warn : console.error)('Jotform webhook: authorization failed (missing or mismatched secret).');
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  // PORTAL-013: Jotform (and Monday, generically) can legitimately redeliver
  // a webhook on a timeout or non-200 response. submissionID uniquely
  // identifies one Jotform submission — when present, it's used below to
  // recognize and skip a redelivery instead of double-attaching UGC files
  // or double-crediting the reward tally.
  const { formID, rawRequest, submissionID } = body;
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
  let tokenOrder = null;
  try {
    tokenOrder = await orderFromToken(submissionData);
  } catch (err) {
    console.error('Monday lookup error (portal_order_token order):', err.message);
    return res.status(500).json({ error: 'Failed to look up order.' });
  }
  const email = extractEmail(submissionData) || tokenOrder?.customerEmail || null;
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
  let order = tokenOrder;
  try {
    if (!order) order = await resolveOrderForSubmission(email.toLowerCase(), formMap, tabType);
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
      // A showcase delivery still attaching files (see the claim below).
      const inFlight = priorUpdates.some((u) => (u.body || '').includes(`(submission-claim:${submissionID})`)
        && Date.now() - new Date(u.created_at).getTime() < SHOWCASE_CLAIM_TTL_MS);
      if (inFlight) {
        return res.status(200).json({ ok: true, duplicate: true, note: 'Submission is already being processed.' });
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

    // Claim BEFORE the (slow, sequential) attaches: the processed marker
    // below only lands after every file is attached, which can take tens of
    // seconds — a Jotform redelivery in that window attached every file and
    // credited the reward tally twice (audit 2026-10-09). The claim uses a
    // distinct marker so a run that fails outright can still be retried
    // once the claim expires.
    if (submissionID) {
      await postTaggedUpdate(
        order.id,
        'PORTAL: Photo/Video Processing',
        `Attaching ${photos.length} photo(s) and ${videos.length} video(s) from a Photo & Video Showcase submission (submission-claim:${submissionID})`
      ).catch(err => console.warn('Jotform webhook: showcase claim write failed (continuing):', err.message));
    }

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
    ).catch(async (err) => {
      // Same treatment as the standard-tab marker below (PORTAL-025): this
      // update IS the dedupe marker, so a silent failure meant a Jotform
      // retry re-attached every file and re-credited the tally.
      console.error('Jotform webhook: failed to post the showcase dedupe marker update:', err.message);
      await reportCriticalFailure(
        'jotform-webhook-dedupe-marker',
        `Failed to record the Photo/Video Showcase marker for order ${order.id}${submissionID ? ` (submission ${submissionID})` : ''} — a Jotform retry of this submission may attach the files and credit the reward tally a second time.`,
        { orderId: order.id, formID, submissionID: submissionID || null, error: err.message }
      );
    });

    // incrementUgcCounts throws when any count write fails — the counts it
    // would have returned were never saved, so don't announce a reward tier
    // the board doesn't show; alert so staff can fix the tally by hand.
    const result = await incrementUgcCounts(order.id, photosOk, videosOk)
      .catch(async (err) => {
        console.error('incrementUgcCounts failed:', err.message);
        await reportCriticalFailure(
          'jotform-webhook-ugc-counts',
          `Order ${order.id} ("${order.name}"): ${photosOk} photo(s) / ${videosOk} video(s) were attached but the UGC photo/video/credit counts failed to save — update them by hand in Monday.`,
          { orderId: order.id, photosOk, videosOk, error: err.message }
        );
        return null;
      });

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
      // Can't tell whether the OTHER forms are in — don't flip ✅ (and stop
      // reminders) on one form of several. The next form's submission
      // re-runs this check.
      tabComplete = false;
      console.error('Jotform webhook: failed to check other forms mapped to this tab — NOT marking the tab complete this time:', err.message);
    }
  }

  // Flip Portal: Color Selections to ✅ — only once every form mapped to the
  // color tab has been submitted. The Required Documents tab was removed from
  // the portal (2026-10-02), so any other mapped form is only recorded above
  // and reported to staff below; it has no checklist column to flip.
  // PORTAL-014: retried and reported honestly instead of silently swallowed —
  // see markSectionCompleteSafe() in lib/monday.js.
  let checklistSynced = true;
  if (tabComplete && isColor) {
    checklistSynced = await markSectionCompleteSafe(order.id, 'portalColors');
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
//
// Audit 2026-10-09: taking the first email-shaped value ANYWHERE meant a form
// with an earlier installer / billing / referral email field routed the
// submission (and the ✅ flip) to that other person's order. Prefer, in
// order: a field whose key names it the customer/contact email, then any
// field whose key mentions "email" and isn't another party's, then the old
// first-anywhere fallback.
const OTHER_PARTY_KEY = /install|billing|bill_to|referr|friend|contractor|vendor|cc_|_cc\b|alternate|secondary/i;
export function extractEmail(data) {
  const entries = [];
  const visit = (key, val) => {
    if (val == null) return;
    if (typeof val === 'string') {
      const match = val.trim().match(EMAIL_RE);
      if (match) entries.push({ key, email: match[0] });
      return;
    }
    if (Array.isArray(val)) { val.forEach((v) => visit(key, v)); return; }
    if (typeof val === 'object') {
      Object.entries(val).forEach(([k, v]) => visit(`${key}.${k}`, v));
    }
  };
  Object.entries(data || {}).forEach(([k, v]) => visit(k, v));

  const pick = (pred) => entries.find((e) => pred(e.key))?.email;
  return pick((k) => /(customer|contact|your)[^.]*email|email[^.]*(customer|contact)/i.test(k) && !OTHER_PARTY_KEY.test(k))
    || pick((k) => /email/i.test(k) && !OTHER_PARTY_KEY.test(k))
    || entries[0]?.email
    || null;
}

/** First non-empty string value whose (nested) key matches `keyPred`. */
function findFieldValue(data, keyPred) {
  let found = null;
  const visit = (key, val) => {
    if (found || val == null) return;
    if (typeof val === 'string') { if (keyPred(key) && val.trim()) found = val.trim(); return; }
    if (Array.isArray(val)) { val.forEach((v) => visit(key, v)); return; }
    if (typeof val === 'object') Object.entries(val).forEach(([k, v]) => visit(`${key}.${k}`, v));
  };
  Object.entries(data || {}).forEach(([k, v]) => visit(k, v));
  return found;
}

// Disable Next.js body parsing so we get the raw form data
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
