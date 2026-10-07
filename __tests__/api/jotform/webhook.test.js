import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrdersByEmail = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockMarkSectionCompleteSafe = vi.fn().mockResolvedValue(true);
const mockAttachUgcFile = vi.fn().mockResolvedValue(undefined);
const mockIncrementUgcCounts = vi.fn().mockResolvedValue({ crossedNewTier: false, photoCount: 0, videoCount: 0, credits: 0 });
vi.mock('../../../lib/monday', () => ({
  getOrdersByEmail: (...args) => mockGetOrdersByEmail(...args),
  getOrderMessages: (...args) => mockGetOrderMessages(...args),
  postTaggedUpdate: (...args) => mockPostTaggedUpdate(...args),
  markSectionCompleteSafe: (...args) => mockMarkSectionCompleteSafe(...args),
  attachUgcFile: (...args) => mockAttachUgcFile(...args),
  incrementUgcCounts: (...args) => mockIncrementUgcCounts(...args),
}));

const mockNotifyTeamFormCompleted = vi.fn().mockResolvedValue(undefined);
const mockNotifyTeamUgcThreshold = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/email', () => ({
  notifyTeamFormCompleted: (...args) => mockNotifyTeamFormCompleted(...args),
  notifyTeamUgcThreshold: (...args) => mockNotifyTeamUgcThreshold(...args),
}));

// The webhook secret check itself is covered elsewhere (PORTAL-011) — every
// test here supplies a request the handler should otherwise accept, so
// secretsMatch is stubbed to always pass rather than re-verified per test.
vi.mock('../../../lib/auth', () => ({
  secretsMatch: () => true,
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const { default: handler, extractEmail, isJotformUploadUrl, extractShowcaseFiles } = await import('../../../pages/api/jotform/webhook.js');

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function makeReq({ formID, tabExtra = {}, submissionID } = {}) {
  return {
    method: 'POST',
    headers: {},
    body: {
      formID,
      submissionID,
      rawRequest: { q3_email: 'repeat.customer@example.com', ...tabExtra },
    },
  };
}

// A single "Required Documents" form mapped to the documents tab, applying
// to every product type (no productTypes filter) — enough to exercise
// formsForTab/resolveOrderForSubmission without an unrelated second form
// muddying which order "complete" should mean.
const DOCUMENTS_FORM_ID = '111';
function setDocumentsFormMap() {
  process.env.JOTFORM_FORM_MAP = JSON.stringify({
    [DOCUMENTS_FORM_ID]: { name: 'W9 Form', tab: 'documents' },
  });
}

const SHOWCASE_FORM_ID = '222';
function setShowcaseFormMap() {
  process.env.JOTFORM_FORM_MAP = JSON.stringify({
    [SHOWCASE_FORM_ID]: { name: 'Photo & Video Showcase', tab: 'showcase' },
  });
}

function documentsMarkerBody(formID = DOCUMENTS_FORM_ID) {
  return `[PORTAL: Documents Submitted (form:${formID})]\nJotform submission received.`;
}

describe('POST /api/jotform/webhook — order resolution (PORTAL-025)', () => {
  beforeEach(() => {
    mockGetOrdersByEmail.mockReset();
    mockGetOrderMessages.mockReset().mockResolvedValue([]);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockAttachUgcFile.mockReset().mockResolvedValue(undefined);
    mockIncrementUgcCounts.mockReset().mockResolvedValue({ crossedNewTier: false, photoCount: 0, videoCount: 0, credits: 0 });
    mockNotifyTeamFormCompleted.mockReset().mockResolvedValue(undefined);
    mockNotifyTeamUgcThreshold.mockReset().mockResolvedValue(undefined);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
  });

  // This is the exact scenario the finding describes: with no orderId
  // anywhere in the Jotform payload, the old getOrderByEmail() always
  // landed on the newest order — even when that newest order's Documents
  // tab was already done and it was really the OLDER order still waiting
  // on this exact form.
  it('attaches a Documents submission to the OLDEST order whose Documents tab is not yet complete, not the newest order', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series' }, // newest first, like the real getOrdersByEmail
      { id: 'order-old', productType: 'Adventure Series' },
    ]);
    mockGetOrderMessages.mockImplementation((itemId) =>
      Promise.resolve(itemId === 'order-new' ? [{ body: documentsMarkerBody() }] : [])
    );

    setDocumentsFormMap();
    const req = makeReq({ formID: DOCUMENTS_FORM_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith(
      'order-old',
      expect.stringContaining(`(form:${DOCUMENTS_FORM_ID})`),
      expect.any(String)
    );
    expect(mockPostTaggedUpdate).not.toHaveBeenCalledWith('order-new', expect.anything(), expect.anything());
  });

  it('falls back to the newest order when every one of the customer\'s orders already has this tab complete', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series' },
      { id: 'order-old', productType: 'Adventure Series' },
    ]);
    mockGetOrderMessages.mockResolvedValue([{ body: documentsMarkerBody() }]); // both orders already complete

    setDocumentsFormMap();
    const req = makeReq({ formID: DOCUMENTS_FORM_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-new', expect.anything(), expect.anything());
  });

  it('skips the multi-order completeness check entirely when the customer has only one order', async () => {
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-only', productType: 'Adventure Series' }]);

    setDocumentsFormMap();
    const req = makeReq({ formID: DOCUMENTS_FORM_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // No completeness lookup needed for a single-order customer.
    expect(mockGetOrderMessages).not.toHaveBeenCalled();
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-only', expect.anything(), expect.anything());
  });

  // Showcase has no completion state (repeatable UGC, no checklist column,
  // and its tagged updates carry no `(form:id)` marker — see the handler's
  // comment). Treating "no signal" as "never complete" would route every
  // later showcase submission from a repeat customer onto an older,
  // unrelated order, so it must keep landing on the newest order.
  it('always resolves a Showcase submission to the newest order, regardless of any tab-completeness signal', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series' },
      { id: 'order-old', productType: 'Adventure Series' },
    ]);

    setShowcaseFormMap();
    const req = makeReq({ formID: SHOWCASE_FORM_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockGetOrderMessages).not.toHaveBeenCalled(); // no completeness check attempted for showcase
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith(
      'order-new',
      'PORTAL: Photo/Video Submitted',
      expect.any(String)
    );
  });
});

describe('POST /api/jotform/webhook — dedupe marker write failure is reported, not swallowed (PORTAL-025)', () => {
  beforeEach(() => {
    mockGetOrdersByEmail.mockReset().mockResolvedValue([{ id: 'order-only', productType: 'Adventure Series' }]);
    mockGetOrderMessages.mockReset().mockResolvedValue([]);
    mockPostTaggedUpdate.mockReset();
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockNotifyTeamFormCompleted.mockReset().mockResolvedValue(undefined);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
    setDocumentsFormMap();
  });

  // Before this fix this was `.catch(console.error)`: the completion/dedupe
  // marker silently never landed on Monday, so a legitimate Jotform retry
  // of the same submission (expected behavior per PORTAL-013) would be
  // fully reprocessed — a second staff notification with no record that the
  // first attempt ever happened.
  it('calls reportCriticalFailure when the completion/dedupe marker update fails, but still returns success to Jotform', async () => {
    mockPostTaggedUpdate.mockRejectedValue(new Error('Monday API unavailable'));

    const req = makeReq({ formID: DOCUMENTS_FORM_ID, submissionID: 'sub-abc123' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith(
      'jotform-webhook-dedupe-marker',
      expect.stringContaining('order-only'),
      expect.objectContaining({ orderId: 'order-only', formID: DOCUMENTS_FORM_ID, submissionID: 'sub-abc123' })
    );
    // The staff notification must still run — a failed audit-trail write
    // shouldn't also break it. A documents form has no checklist column to
    // flip any more (Required Documents was removed from the portal).
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
    expect(mockNotifyTeamFormCompleted).toHaveBeenCalled();
  });

  it('does NOT call reportCriticalFailure when the marker update succeeds', async () => {
    mockPostTaggedUpdate.mockResolvedValue(undefined);

    const req = makeReq({ formID: DOCUMENTS_FORM_ID });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).not.toHaveBeenCalled();
  });
});

// ── AUDIT-2026-10-06 ─────────────────────────────────────────────────────────

const COLOR_FORM_ID = '333';
const MATS_COLOR_FORM_ID = '444';
function setColorFormMap() {
  process.env.JOTFORM_FORM_MAP = JSON.stringify({
    [COLOR_FORM_ID]: { name: 'Frame Colors', tab: 'color', productTypes: ['Adventure Series'] },
    [MATS_COLOR_FORM_ID]: { name: 'Mat Colors', tab: 'color', productTypes: ['Therapy Mats & Pads'] },
  });
}
const colorMarker = (formID) => `[PORTAL: Color Selections (form:${formID})]\nJotform submission received.`;

function resetAll() {
  mockGetOrdersByEmail.mockReset();
  mockGetOrderMessages.mockReset().mockResolvedValue([]);
  mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
  mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
  mockAttachUgcFile.mockReset().mockResolvedValue(undefined);
  mockIncrementUgcCounts.mockReset().mockResolvedValue({ crossedNewTier: false, photoCount: 0, videoCount: 0, credits: 0 });
  mockNotifyTeamFormCompleted.mockReset().mockResolvedValue(undefined);
  mockNotifyTeamUgcThreshold.mockReset().mockResolvedValue(undefined);
  mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
}

describe('POST /api/jotform/webhook — color routing (AUDIT-2026-10-06)', () => {
  beforeEach(() => { resetAll(); setColorFormMap(); });

  it('skips an older order whose Portal: Color Selections is already ✅ (native picker / Mark Complete — no Jotform note)', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series', progress: { colors: '' } },
      { id: 'order-old', productType: 'Adventure Series', progress: { colors: '✅' } },
    ]);
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res);
    expect(res.statusCode).toBe(200);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-new', expect.stringContaining(`(form:${COLOR_FORM_ID})`), expect.any(String));
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalledWith('order-new', 'portalColors');
  });

  it('treats N/A the same as ✅', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series', progress: { colors: '' } },
      { id: 'order-old', productType: 'Adventure Series', progress: { colors: 'N/A' } },
    ]);
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-new', expect.anything(), expect.anything());
  });

  it('never routes a form to an older order whose product type does not use it', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series', progress: { colors: '' } },
      { id: 'order-old', productType: 'Therapy Mats & Pads', progress: { colors: '' } }, // incomplete, but needs a different form
    ]);
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-new', expect.anything(), expect.anything());
    expect(mockPostTaggedUpdate).not.toHaveBeenCalledWith('order-old', expect.anything(), expect.anything());
  });

  it('does not flip ✅ when the submitted form does not apply to the order it landed on, even with one required form', async () => {
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-only', productType: 'Therapy Mats & Pads', progress: { colors: '' } }]);
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res); // Adventure Series form on a Mats order
    expect(res.statusCode).toBe(200);
    expect(res.body.tabComplete).toBe(false);
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
    expect(mockNotifyTeamFormCompleted).toHaveBeenCalled(); // staff still hear about it
  });

  it('only flips ✅ once every required form for the order is in', async () => {
    process.env.JOTFORM_FORM_MAP = JSON.stringify({
      [COLOR_FORM_ID]: { name: 'Frame Colors', tab: 'color' },
      [MATS_COLOR_FORM_ID]: { name: 'Mat Colors', tab: 'color' },
    });
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-only', productType: 'Adventure Series' }]);
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res);
    expect(res.body.tabComplete).toBe(false);
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();

    mockGetOrderMessages.mockResolvedValue([{ body: colorMarker(MATS_COLOR_FORM_ID) }]);
    const res2 = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res2);
    expect(res2.body.tabComplete).toBe(true);
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalledWith('order-only', 'portalColors');
  });

  it('does not mark the tab complete when the other-forms check cannot read the history', async () => {
    process.env.JOTFORM_FORM_MAP = JSON.stringify({
      [COLOR_FORM_ID]: { name: 'Frame Colors', tab: 'color' },
      [MATS_COLOR_FORM_ID]: { name: 'Mat Colors', tab: 'color' },
    });
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-only', productType: 'Adventure Series' }]);
    mockGetOrderMessages.mockRejectedValue(new Error('Monday down'));
    const res = makeRes();
    await handler(makeReq({ formID: COLOR_FORM_ID }), res);
    expect(res.body.tabComplete).toBe(false);
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
  });
});

describe('POST /api/jotform/webhook — redelivery dedupe across orders (AUDIT-2026-10-06)', () => {
  beforeEach(() => { resetAll(); setDocumentsFormMap(); });

  // First delivery landed on order-old (oldest incomplete). Its note now makes
  // order-old "complete", so routing alone would pick order-new on retry.
  it('recognizes a redelivery whose marker is on a different order than routing would now pick', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series' },
      { id: 'order-old', productType: 'Adventure Series' },
    ]);
    mockGetOrderMessages.mockImplementation((id) => Promise.resolve(id === 'order-old'
      ? [{ body: `${documentsMarkerBody()} (submission:sub-1)` }]
      : []));
    const res = makeRes();
    await handler(makeReq({ formID: DOCUMENTS_FORM_ID, submissionID: 'sub-1' }), res);
    expect(res.body.duplicate).toBe(true);
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
    expect(mockNotifyTeamFormCompleted).not.toHaveBeenCalled();
  });

  it('reads each order\'s history once even though dedupe and routing both need it', async () => {
    mockGetOrdersByEmail.mockResolvedValue([
      { id: 'order-new', productType: 'Adventure Series' },
      { id: 'order-old', productType: 'Adventure Series' },
    ]);
    const res = makeRes();
    await handler(makeReq({ formID: DOCUMENTS_FORM_ID, submissionID: 'sub-2' }), res);
    expect(mockGetOrderMessages).toHaveBeenCalledTimes(2);
    expect(mockPostTaggedUpdate).toHaveBeenCalledWith('order-old', expect.anything(), expect.stringContaining('(submission:sub-2)'));
  });
});

describe('POST /api/jotform/webhook — unroutable submissions alert staff (AUDIT-2026-10-06)', () => {
  beforeEach(() => { resetAll(); setDocumentsFormMap(); });

  it('alerts when no order uses the submitted email', async () => {
    mockGetOrdersByEmail.mockResolvedValue([]);
    const res = makeRes();
    await handler(makeReq({ formID: DOCUMENTS_FORM_ID, submissionID: 'sub-9' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-unrouted', expect.stringContaining('sub-9'), expect.objectContaining({ formID: DOCUMENTS_FORM_ID, submissionID: 'sub-9' }));
  });

  it('alerts when the form is not mapped', async () => {
    const res = makeRes();
    await handler(makeReq({ formID: '999', submissionID: 'sub-8' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-unrouted', expect.stringContaining('999'), expect.objectContaining({ formID: '999' }));
  });

  it('alerts when the submission has no email at all', async () => {
    const req = makeReq({ formID: DOCUMENTS_FORM_ID });
    req.body.rawRequest = { q1_name: 'No Email Here' };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-unrouted', expect.any(String), expect.objectContaining({ formID: DOCUMENTS_FORM_ID }));
  });
});

describe('extractEmail (AUDIT-2026-10-06)', () => {
  it('prefers an email field over an earlier email-shaped value elsewhere', () => {
    expect(extractEmail({ q1_notes: 'cc principal@school.org please', q3_email: 'buyer@school.org' })).toBe('buyer@school.org');
    expect(extractEmail({ q2_contact: 'x@y.org', q5_yourEmail: 'Real@School.org' })).toBe('Real@School.org');
  });

  it('honors control_email typed answers', () => {
    expect(extractEmail({ 1: { type: 'control_textbox', answer: 'other@x.org' }, 3: { type: 'control_email', answer: 'me@x.org' } })).toBe('me@x.org');
  });

  it('falls back to the first email-shaped value when no email field has one', () => {
    expect(extractEmail({ q1_notes: 'reach me at a@b.org' })).toBe('a@b.org');
    expect(extractEmail({ q1_name: 'nobody' })).toBe(null);
  });
});

describe('showcase upload URLs (AUDIT-2026-10-06)', () => {
  const url = (file, { form = '222', sub = '555', host = 'www.jotform.com' } = {}) => `https://${host}/uploads/acct/${form}/${sub}/${file}`;

  it('accepts only real Jotform upload paths for this form/submission', () => {
    expect(isJotformUploadUrl(url('a.jpg'), '222', '555')).toBe(true);
    expect(isJotformUploadUrl(url('a.jpg', { host: 'eu.jotform.com' }), '222', '555')).toBe(true);
    expect(isJotformUploadUrl(url('a.jpg', { host: 'evil.example.com' }), '222', '555')).toBe(false);
    expect(isJotformUploadUrl(url('a.jpg', { host: 'jotform.com.evil.com' }), '222', '555')).toBe(false);
    expect(isJotformUploadUrl(url('a.jpg', { form: '111' }), '222', '555')).toBe(false);
    expect(isJotformUploadUrl(url('a.jpg', { sub: '666' }), '222', '555')).toBe(false);
    expect(isJotformUploadUrl('https://www.jotform.com/form/222/a.jpg', '222', '555')).toBe(false);
    expect(isJotformUploadUrl(url('a.jpg').replace('https', 'http'), '222', '555')).toBe(false);
  });

  it('ignores non-Jotform links and dedupes ignoring query strings', () => {
    const files = extractShowcaseFiles({
      q4_upload: JSON.stringify([url('a.jpg'), `${url('a.jpg')}?token=1`, url('b.mp4')]),
      q5_notes: 'see https://example.com/c.jpg',
    }, '222', '555');
    expect(files.photos).toEqual([url('a.jpg')]);
    expect(files.videos).toEqual([url('b.mp4')]);
  });
});

describe('POST /api/jotform/webhook — showcase note failure is reported (AUDIT-2026-10-06)', () => {
  beforeEach(() => { resetAll(); setShowcaseFormMap(); });

  it('calls reportCriticalFailure when the showcase submission note fails to post', async () => {
    mockGetOrdersByEmail.mockResolvedValue([{ id: 'order-only', productType: 'Adventure Series' }]);
    mockPostTaggedUpdate.mockRejectedValue(new Error('Monday down'));
    const res = makeRes();
    await handler(makeReq({ formID: SHOWCASE_FORM_ID, submissionID: '555' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-dedupe-marker', expect.any(String), expect.objectContaining({ orderId: 'order-only', submissionID: '555' }));
  });
});
