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
//
// AUDIT-2026-10-06: three routing gaps fixed —
//   - a candidate only counts if THIS formID applies to its product type
//     (formsForTab(...).includes(formID)). Before, a form scoped to another
//     product line could land on an order that could never use it, just
//     because that order was the oldest "incomplete" one.
//   - "complete" also honors the real Portal: Color Selections status
//     (order.progress.colors ✅ / N/A), not only `(form:id)` notes. Orders
//     finished via the native picker or staff "Mark Complete" have no
//     Jotform note at all, so they used to absorb every later submission.
//   - an order that already has THIS form's note is skipped, so a tab with
//     several forms can't take a second copy of one form while a sibling
//     order is still waiting on it.
// `orders` is passed in (the handler already fetched it for the cross-order
// dedupe check) and `messagesFor` is the handler's per-request memo, so no
// order's update history is read twice.
async function resolveOrderForSubmission(orders, formMap, tabType, formID, messagesFor) {
  if (orders.length <= 1 || tabType === 'showcase') return orders[0] || null;

  const applicable = orders.filter((o) => formsForTab(formMap, tabType, o.productType).includes(formID));
  // No order's product type uses this form — keep the newest-order default.
  if (!applicable.length) return orders[0];

  const tag = submissionTagFor(tabType);
  const oldestFirst = [...applicable].reverse();
  for (const candidate of oldestFirst) {
    if (tabType === 'color' && DONE_PROGRESS_LABELS.has(candidate.progress?.colors)) continue;

    let bodies;
    try {
      const updates = await messagesFor(candidate.id);
      bodies = updates.map((u) => u.body || '');
    } catch (err) {
      // Can't verify this candidate's completeness — rather than guess (and
      // risk silently misrouting the submission), fall back to the newest
      // order this form applies to.
      console.error('Jotform webhook: failed to check tab completeness for order', candidate.id, err.message);
      return applicable[0];
    }

    const alreadyHasThisForm = bodies.some((b) => b.includes(tag) && b.includes(`(form:${formID})`));
    if (!alreadyHasThisForm) return candidate;
  }

  // Every applicable order already has this form in (or its tab is done) —
  // default to the newest one.
  return applicable[0];
}

// AUDIT-2026-10-06: the same "done" labels reminders.js (DONE_LABELS) and the
// portal's progress bar use. Hardcoded rather than imported from
// lib/monday.js, matching reminders.js.
const DONE_PROGRESS_LABELS = new Set(['✅', 'N/A']);

// AUDIT-2026-10-06: real Jotform upload links look like
//   https://www.jotform.com/uploads/<account>/<formID>/<submissionID>/<file>
// Any other URL in the submission (a link typed into a text field, a file on
// some other site) used to be attached and credited toward the UGC reward
// just for ending in .jpg/.mp4. Only this form's own uploads count now — and
// only this submission's, when the payload names it.
export function isJotformUploadUrl(url, formID, submissionID) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'jotform.com' && !host.endsWith('.jotform.com')) return false;
  const m = /^\/uploads\/[^/]+\/(\d+)\/(\d+)\/[^/]+/.exec(parsed.pathname);
  if (!m) return false;
  if (formID && m[1] !== String(formID)) return false;
  if (submissionID && m[2] !== String(submissionID)) return false;
  return true;
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
//
// AUDIT-2026-10-06: only real Jotform upload URLs for this form/submission
// count (isJotformUploadUrl above), and duplicates are detected ignoring the
// query string — the same file can appear once bare and once with a
// `?…` token, which used to attach (and credit) it twice.
export function extractShowcaseFiles(data, formID, submissionID) {
  const photos = new Map(); // origin+path -> first URL seen
  const videos = new Map();

  const classify = (url) => {
    if (typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!isJotformUploadUrl(trimmed, formID, submissionID)) return;
    const { origin, pathname } = new URL(trimmed);
    const key = `${origin}${pathname}`;
    if (IMAGE_EXT.test(pathname)) { if (!photos.has(key)) photos.set(key, trimmed); }
    else if (VIDEO_EXT.test(pathname)) { if (!videos.has(key)) videos.set(key, trimmed); }
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

  return { photos: [...photos.values()], videos: [...videos.values()] };
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
  // AUDIT-2026-10-06: the three "skipped" branches below used to only log
  // and return 200, so an authenticated, real customer submission could be
  // dropped with nobody told (the customer believes they're done). Staff now
  // get the submission/form ids to file it by hand. Still 200 — a Jotform
  // retry would hit the same dead end.
  const alertUnrouted = (why, extra = {}) => reportCriticalFailure(
    'jotform-webhook-unrouted',
    `A Jotform submission was received but could not be recorded on any order: ${why}. Find it in Jotform (form ${formID}${submissionID ? `, submission ${submissionID}` : ''}) and record it on the right order by hand.`,
    { formID, submissionID: submissionID || null, ...extra }
  );

  const email = extractEmail(submissionData);
  if (!email) {
    await alertUnrouted('no email address found in the submission');
    return res.status(200).json({ ok: true, note: 'No email found — skipped.' });
  }

  // Look up the form mapping
  const formMap = getFormMap();
  const formConfig = formMap[formID];
  if (!formConfig) {
    await alertUnrouted('this form id is not in JOTFORM_FORM_MAP (nor JOTFORM_SHOWCASE_FORM_ID / JOTFORM_COLOR_FORM_ID)', { email });
    return res.status(200).json({ ok: true, note: 'No mapping for this form.' });
  }

  // Dispatch by form type — color selections, required documents, or the
  // repeatable Photo & Video Showcase (not a one-time checklist item).
  // Resolved before the order lookup now (see resolveOrderForSubmission's
  // header comment) since PORTAL-025's multi-order resolution needs to know
  // which checklist to check completeness against.
  const tabType = resolveTabType(formConfig);

  let orders;
  try {
    orders = await getOrdersByEmail(email.toLowerCase()); // sorted newest → oldest
  } catch (err) {
    console.error('Monday lookup error:', err.message);
    return res.status(500).json({ error: 'Failed to look up order.' });
  }

  if (!orders.length) {
    await alertUnrouted(`no order uses the submitted email ${email}`, { email });
    return res.status(200).json({ ok: true, note: 'No order found for email.' });
  }

  // One read of each order's update history per request, shared by the
  // dedupe check and order resolution below.
  const messageCache = new Map();
  const messagesFor = (id) => {
    if (!messageCache.has(id)) messageCache.set(id, getOrderMessages(id));
    return messageCache.get(id);
  };

  // PORTAL-013: skip a redelivery of a submission we've already recorded.
  // Marker is embedded in the tagged update posted below (both the showcase
  // and the standard-tab paths), so this only works going forward for
  // submissions processed after this fix — acceptable, since the goal is
  // to stop future double-processing, not retroactively audit past ones.
  // AUDIT-2026-10-06: checked on EVERY one of the customer's orders, before
  // routing. It used to check only the routed order — but the first delivery
  // changes what routing picks (that order now has this form's note), so a
  // redelivery routed to a different order and was processed again.
  if (submissionID) {
    for (const o of orders) {
      try {
        const priorUpdates = await messagesFor(o.id);
        if (priorUpdates.some((u) => (u.body || '').includes(`(submission:${submissionID})`))) {
          return res.status(200).json({ ok: true, duplicate: true, note: 'Submission already processed.' });
        }
      } catch (err) {
        // Non-fatal — if the dedupe check itself fails, proceed rather than
        // block a legitimate submission over it.
        console.error(`Jotform webhook: dedupe check failed for order ${o.id} (continuing anyway):`, err.message);
      }
    }
  }

  // Find the order. PORTAL-025: no longer just "the customer's most recent
  // order" — see resolveOrderForSubmission above for why.
  const order = await resolveOrderForSubmission(orders, formMap, tabType, formID, messagesFor);
  const submissionTag = submissionID ? ` (submission:${submissionID})` : '';

  // tabType was already resolved above (needed for order resolution).
  if (tabType === 'showcase') {
    const { photos, videos } = extractShowcaseFiles(submissionData, formID, submissionID);

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
      // AUDIT-2026-10-06: this note is the showcase path's PORTAL-013 dedupe
      // marker too — a bare `.catch(console.error)` meant a Jotform retry
      // re-attached every file and credited the reward tally twice. Reported
      // the same way as the standard-tab marker below (PORTAL-025).
      console.error('Jotform webhook: failed to post the showcase submission/dedupe marker update:', err.message);
      await reportCriticalFailure(
        'jotform-webhook-dedupe-marker',
        `Failed to record the Photo/Video submission note for order ${order.id} (form ${formID}${submissionID ? `, submission ${submissionID}` : ''}) — ${photosOk} photo(s) / ${videosOk} video(s) were attached, but a Jotform retry of this submission may attach and credit them again.`,
        { orderId: order.id, formID, submissionID: submissionID || null, error: err.message }
      );
    });

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

  // AUDIT-2026-10-06: the tab is only complete if THIS form is one the order
  // actually needs (a form scoped to another product type, landing here via
  // the newest-order fallback, used to flip ✅ on its own) AND every other
  // required form is in. The every-form check used to run only when 2+ forms
  // were required, which is how the first gap slipped through. A failed
  // history read no longer assumes complete — a false ✅ is the exact bug
  // class PORTAL-014 was about; staff are still notified below either way.
  const requiredFormIds = formsForTab(formMap, tabType, order.productType);
  let tabComplete = requiredFormIds.includes(formID);
  const otherFormIds = requiredFormIds.filter((id) => id !== formID);
  if (tabComplete && otherFormIds.length) {
    try {
      const updates = await messagesFor(order.id);
      const bodies = updates.map(u => u.body || '');
      tabComplete = otherFormIds.every((id) =>
        bodies.some((b) => b.includes(tag) && b.includes(`(form:${id})`))
      );
    } catch (err) {
      tabComplete = false;
      console.error('Jotform webhook: failed to check other forms mapped to this tab — NOT marking the tab complete:', err.message);
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
// AUDIT-2026-10-06: an email-shaped value in a field that IS an email field
// now wins over one found anywhere else. Taking the first match in key order
// meant a form with e.g. a "school contact" or "notes" field before the
// customer's own Email field routed the submission by the wrong address.
// An email field is one whose rawRequest key says so (`q3_email`,
// `q5_yourEmail`) or, in the API's answer shape, whose `type` is
// `control_email`. Falls back to the old first-match behavior only when no
// email field has a usable value.
const EMAIL_KEY_RE = /email/i;

export function extractEmail(data) {
  let preferred = null;
  let fallback = null;

  const visit = (val, inEmailField) => {
    if (preferred || val == null) return;
    if (typeof val === 'string') {
      const match = val.trim().match(EMAIL_RE);
      if (!match) return;
      if (inEmailField) preferred = match[0];
      else if (!fallback) fallback = match[0];
      return;
    }
    if (Array.isArray(val)) { val.forEach((v) => visit(v, inEmailField)); return; }
    if (typeof val === 'object') {
      const typedEmail = inEmailField || val.type === 'control_email';
      for (const [k, v] of Object.entries(val)) visit(v, typedEmail || EMAIL_KEY_RE.test(k));
    }
  };

  for (const [k, v] of Object.entries(data || {})) visit(v, EMAIL_KEY_RE.test(k));
  return preferred || fallback;
}

// Disable Next.js body parsing so we get the raw form data
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
