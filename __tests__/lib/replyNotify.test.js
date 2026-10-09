import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOrderById = vi.fn();
const mockGetOrderMessages = vi.fn();
const mockPostTaggedUpdate = vi.fn().mockResolvedValue({ id: 'm1' });
const mockSetStatusLabel = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/monday', () => ({
  getOrderById: (...a) => mockGetOrderById(...a),
  getOrderMessages: (...a) => mockGetOrderMessages(...a),
  postTaggedUpdate: (...a) => mockPostTaggedUpdate(...a),
  setStatusLabel: (...a) => mockSetStatusLabel(...a),
}));
const mockSend = vi.fn().mockResolvedValue({ id: 'e1' });
vi.mock('../../lib/email', () => ({ sendCustomerReplyNotification: (...a) => mockSend(...a) }));

const { findUnnotifiedStaffMessages, notifyPendingStaffReplies, previewText } = await import('../../lib/replyNotify.js');

const NOW = new Date('2026-10-07T15:00:00Z');
const t = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const staff = { email: 'kyle@summitsensory.com' };
const customerMsg = (id, replies = [], min = 120) => ({ id, body: '[PORTAL][PORTAL:CUSTOMER]\nWhen will it ship?', created_at: t(min), creator: staff, replies });
const staffReply = (id, body, min) => ({ id, body, created_at: t(min), creator: staff });
const marker = (ids, min) => ({ id: `mk${min}`, body: `[PORTAL: Reply Notified]\nStaff reply notification emailed to a@b.com on 10/7/2026 (${ids}).`, created_at: t(min), creator: staff, replies: [] });

describe('findUnnotifiedStaffMessages', () => {
  it('never counts an internal top-level note typed in Monday — the customer cannot see it', () => {
    const updates = [{ id: '1', body: 'GB says paint is late, do not tell them yet', created_at: t(30), creator: staff, replies: [] }];
    expect(findUnnotifiedStaffMessages(updates, { now: NOW })).toEqual([]);
  });

  it('counts a staff reply threaded under the customer\'s portal message', () => {
    const updates = [customerMsg('10', [staffReply('11', 'Friday!', 30)])];
    expect(findUnnotifiedStaffMessages(updates, { now: NOW }).map(m => m.id)).toEqual(['11']);
  });

  it('ignores the customer\'s own replies and the portal\'s audit tags', () => {
    const updates = [
      customerMsg('10', [{ id: '12', body: 'thanks', created_at: t(20), creator: { email: 'a@school.org' } }]),
      { id: '13', body: '[PORTAL: Reminder #2]\n…', created_at: t(10), creator: staff, replies: [] },
    ];
    expect(findUnnotifiedStaffMessages(updates, { now: NOW })).toEqual([]);
  });

  it('dedupes by id, so a second quick reply is still pending after the first was notified', () => {
    const updates = [
      customerMsg('10', [staffReply('11', 'one', 5), staffReply('14', 'two', 4)]),
      marker('reply 11', 3),
    ];
    expect(findUnnotifiedStaffMessages(updates, { now: NOW }).map(m => m.id)).toEqual(['14']);
  });

  it('leaves fresh Admin Portal posts to messages.js, then picks them up if that send was missed', () => {
    const post = (min) => ({ id: '20', body: '[PORTAL][PORTAL:STAFF]\nHi!', created_at: t(min), creator: staff, replies: [] });
    expect(findUnnotifiedStaffMessages([post(2)], { now: NOW })).toEqual([]);
    expect(findUnnotifiedStaffMessages([post(2)], { now: NOW, includeFreshAdminPosts: true }).map(m => m.id)).toEqual(['20']);
    expect(findUnnotifiedStaffMessages([post(15)], { now: NOW }).map(m => m.id)).toEqual(['20']);
  });

  it('never re-sends replies from before id markers existed', () => {
    const old = [customerMsg('10', [{ id: '11', body: 'old', created_at: '2026-10-02T18:41:00Z', creator: staff }], 9000)];
    expect(findUnnotifiedStaffMessages(old, { now: NOW })).toEqual([]);
  });
});

describe('notifyPendingStaffReplies', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({ id: 'e1' });
    mockPostTaggedUpdate.mockReset().mockResolvedValue({ id: 'm1' });
    mockGetOrderById.mockReset().mockResolvedValue({ id: '9', name: 'Acme', customerEmail: 'a@school.org', firstName: 'Ann' });
  });

  it('sends one email covering every pending reply and marks them all by id', async () => {
    const updates = [customerMsg('10', [staffReply('11', 'one', 6), staffReply('14', '<p>two</p>', 5)])];
    const result = await notifyPendingStaffReplies('9', { now: NOW, updates });
    expect(result.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('a@school.org', 'Ann', 'Acme', 'two', { idempotencyKey: expect.stringMatching(/^reply\/9\//) });
    expect(mockPostTaggedUpdate.mock.calls[0][2]).toContain('reply 11, reply 14');
  });

  // Audit 2026-10-09: two staff replies seconds apart fired two webhook
  // calls that both emailed the customer about the same pending reply.
  it('keys the send on the pending-id set and treats a Resend idempotency conflict as already handled', async () => {
    const updates = [customerMsg('10', [staffReply('11', 'one', 6)])];
    await notifyPendingStaffReplies('9', { now: NOW, updates });
    mockSend.mockRejectedValueOnce(Object.assign(new Error('concurrent idempotent requests'), { idempotencyConflict: true }));
    const second = await notifyPendingStaffReplies('9', { now: NOW, updates });
    expect(mockSend.mock.calls.at(-1)[4].idempotencyKey).toBe(mockSend.mock.calls.at(-2)[4].idempotencyKey);
    expect(second.sent).toBe(false);
  });

  it('does not mark anything when the send fails, so the next run retries', async () => {
    mockSend.mockRejectedValue(new Error('resend down'));
    const updates = [customerMsg('10', [staffReply('11', 'one', 6)])];
    await expect(notifyPendingStaffReplies('9', { now: NOW, updates })).rejects.toThrow('resend down');
    expect(mockPostTaggedUpdate).not.toHaveBeenCalled();
  });

  it('still emails an image-only reply with a generic preview', async () => {
    const updates = [customerMsg('10', [staffReply('11', '<img src="x.png">', 6)])];
    await notifyPendingStaffReplies('9', { now: NOW, updates });
    expect(mockSend.mock.calls[0][3]).toMatch(/new message/i);
  });

  it('does nothing when nothing is pending', async () => {
    const result = await notifyPendingStaffReplies('9', { now: NOW, updates: [customerMsg('10')] });
    expect(result.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('previewText', () => {
  it('strips portal tags and HTML', () => {
    expect(previewText('[PORTAL][PORTAL:STAFF]\n<p>Ships&nbsp;Friday</p>')).toBe('Ships Friday');
  });
});

describe('old-style markers', () => {
  it('treat everything posted before them as already notified', () => {
    const legacy = { id: 'old', body: '[PORTAL: Reply Notified]\nStaff reply notification emailed to a@b.com on 10/6/2026.', created_at: t(3), creator: staff, replies: [] };
    const updates = [customerMsg('10', [staffReply('11', 'before', 5), staffReply('15', 'after', 1)]), legacy];
    expect(findUnnotifiedStaffMessages(updates, { now: NOW }).map(m => m.id)).toEqual(['15']);
  });
});
