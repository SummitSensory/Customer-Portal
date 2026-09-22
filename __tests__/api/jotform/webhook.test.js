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

const { default: handler } = await import('../../../pages/api/jotform/webhook.js');

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
    // The rest of the flow (checklist sync, staff notification) must still
    // run — a failed audit-trail write shouldn't also break completion.
    expect(mockMarkSectionCompleteSafe).toHaveBeenCalled();
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
