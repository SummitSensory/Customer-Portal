import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrdersByEmail = vi.fn();
const mockGetOrderById = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockPostTaggedUpdate = vi.fn().mockResolvedValue(undefined);
const mockMarkSectionCompleteSafe = vi.fn().mockResolvedValue(true);
const mockAttachUgcFile = vi.fn().mockResolvedValue(undefined);
const mockIncrementUgcCounts = vi.fn().mockResolvedValue({ crossedNewTier: false, photoCount: 0, videoCount: 0, credits: 0 });
vi.mock('../../../lib/monday', () => ({
  getOrdersByEmail: (...args) => mockGetOrdersByEmail(...args),
  getOrderById: (...args) => mockGetOrderById(...args),
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
  verifyFormOrderToken: async (t) => (t === 'good-token' ? { orderId: 'order-token' } : null),
}));

const mockReportCriticalFailure = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/monitoring', () => ({
  reportCriticalFailure: (...args) => mockReportCriticalFailure(...args),
}));

const { default: handler, extractEmail } = await import('../../../pages/api/jotform/webhook.js');

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

// Audit 2026-10-09 fixes.
describe('POST /api/jotform/webhook — audit 2026-10-09', () => {
  beforeEach(() => {
    mockGetOrdersByEmail.mockReset().mockResolvedValue([{ id: 'order-email', name: 'Email Order', productType: 'Adventure Series' }]);
    mockGetOrderById.mockReset().mockResolvedValue({ id: 'order-token', name: 'Token Order', productType: 'Adventure Series', customerEmail: 'owner@school.org' });
    mockGetOrderMessages.mockReset().mockResolvedValue([]);
    mockPostTaggedUpdate.mockReset().mockResolvedValue(undefined);
    mockMarkSectionCompleteSafe.mockReset().mockResolvedValue(true);
    mockAttachUgcFile.mockReset().mockResolvedValue(undefined);
    mockIncrementUgcCounts.mockReset().mockResolvedValue({ crossedNewTier: false, photoCount: 0, videoCount: 0, credits: 0 });
    mockNotifyTeamFormCompleted.mockReset().mockResolvedValue(undefined);
    mockNotifyTeamUgcThreshold.mockReset().mockResolvedValue(undefined);
    mockReportCriticalFailure.mockReset().mockResolvedValue(undefined);
  });

  it('extractEmail prefers the customer email field over an earlier installer/billing email', () => {
    expect(extractEmail({ q2_installerEmail: 'installer@co.com', q5_email: 'customer@school.org' })).toBe('customer@school.org');
    expect(extractEmail({ q2_billingEmail: 'ap@school.org', q9_contactEmail: 'pat@school.org' })).toBe('pat@school.org');
    expect(extractEmail({ q1_notes: 'call joe@x.com', q3_email: 'c@school.org' })).toBe('c@school.org');
    expect(extractEmail({ q1_notes: 'only joe@x.com here' })).toBe('joe@x.com');
  });

  it('a valid portal_order_token picks the order regardless of the typed-in email', async () => {
    setDocumentsFormMap();
    const res = makeRes();
    await handler(makeReq({ formID: DOCUMENTS_FORM_ID, tabExtra: { q20_portal_order_token: 'good-token' } }), res);
    expect(res.body.orderName).toBe('Token Order');
    expect(mockGetOrdersByEmail).not.toHaveBeenCalled();
  });

  it('an invalid portal_order_token falls back to email matching', async () => {
    setDocumentsFormMap();
    const res = makeRes();
    await handler(makeReq({ formID: DOCUMENTS_FORM_ID, tabExtra: { q20_portal_order_token: 'forged' } }), res);
    expect(res.body.orderName).toBe('Email Order');
  });

  it('showcase: posts a claim before attaching, and a redelivery during the attach window is skipped', async () => {
    setShowcaseFormMap();
    const res = makeRes();
    await handler(makeReq({ formID: SHOWCASE_FORM_ID, submissionID: 'S1', tabExtra: { q4_photos: 'https://www.jotform.com/uploads/a.jpg' } }), res);
    const claimIdx = mockPostTaggedUpdate.mock.calls.findIndex((c) => String(c[2]).includes('(submission-claim:S1)'));
    expect(claimIdx).toBe(0);
    expect(mockAttachUgcFile.mock.invocationCallOrder[0]).toBeGreaterThan(mockPostTaggedUpdate.mock.invocationCallOrder[0]);

    mockGetOrderMessages.mockResolvedValue([{ body: '[PORTAL: Photo/Video Processing] (submission-claim:S1)', created_at: new Date().toISOString() }]);
    mockAttachUgcFile.mockClear();
    const res2 = makeRes();
    await handler(makeReq({ formID: SHOWCASE_FORM_ID, submissionID: 'S1', tabExtra: { q4_photos: 'https://www.jotform.com/uploads/a.jpg' } }), res2);
    expect(res2.body.duplicate).toBe(true);
    expect(mockAttachUgcFile).not.toHaveBeenCalled();
  });

  it('showcase: a failed UGC count write is reported and no reward-tier email goes out', async () => {
    setShowcaseFormMap();
    mockIncrementUgcCounts.mockRejectedValue(new Error('UGC count writes failed: photoCount'));
    const res = makeRes();
    await handler(makeReq({ formID: SHOWCASE_FORM_ID, submissionID: 'S2', tabExtra: { q4_photos: 'https://www.jotform.com/uploads/a.jpg' } }), res);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-ugc-counts', expect.any(String), expect.objectContaining({ orderId: 'order-email' }));
    expect(mockNotifyTeamUgcThreshold).not.toHaveBeenCalled();
  });

  it('showcase: a failed dedupe-marker write is reported', async () => {
    setShowcaseFormMap();
    mockPostTaggedUpdate.mockImplementation((id, tag) => (tag === 'PORTAL: Photo/Video Submitted' ? Promise.reject(new Error('Monday down')) : Promise.resolve(undefined)));
    const res = makeRes();
    await handler(makeReq({ formID: SHOWCASE_FORM_ID, submissionID: 'S3', tabExtra: { q4_photos: 'https://www.jotform.com/uploads/a.jpg' } }), res);
    expect(mockReportCriticalFailure).toHaveBeenCalledWith('jotform-webhook-dedupe-marker', expect.any(String), expect.anything());
  });

  it('color tab with several forms is NOT marked complete when the history read fails', async () => {
    process.env.JOTFORM_FORM_MAP = JSON.stringify({
      c1: { name: 'Color A', tab: 'color' },
      c2: { name: 'Color B', tab: 'color' },
    });
    // First read (dedupe) ok, second read (completeness) fails.
    mockGetOrderMessages.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Monday timeout'));
    const res = makeRes();
    await handler(makeReq({ formID: 'c1', submissionID: 'S4' }), res);
    expect(res.body.tabComplete).toBe(false);
    expect(mockMarkSectionCompleteSafe).not.toHaveBeenCalled();
  });
});
