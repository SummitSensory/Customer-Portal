import { describe, it, expect } from 'vitest';
import { customerVisibleMessages, isStaffMessage, isStaffReply } from './messageOrigin';

describe('customerVisibleMessages', () => {
  const updates = [
    { id: '1', body: '[PORTAL][PORTAL:CUSTOMER]\nhi', created_at: 't1', creator: { name: 'Bryan', email: 'bryan@summitsensory.com' }, assets: [{ url: 'x' }], replies: [
      { id: '1a', body: 'reply', created_at: 't2', creator: { name: 'Kyle', email: 'kyle@summitsensory.com' } },
    ] },
    { id: '2', body: 'internal staff note', created_at: 't3', creator: { name: 'Kyle', email: 'kyle@summitsensory.com' } },
    { id: '3', body: '[PORTAL: Reminder #1]\nsent', created_at: 't4', creator: { name: 'Bryan', email: 'bryan@summitsensory.com' } },
    { id: '4', body: '[PORTAL]\nlegacy untagged staff post', created_at: 't5', creator: { name: 'Bryan', email: 'bryan@summitsensory.com' } },
  ];

  it('keeps only portal chat and reduces creators to display names', () => {
    const out = customerVisibleMessages(updates);
    expect(out.map(m => m.id)).toEqual(['1', '4']);
    expect(JSON.stringify(out)).not.toContain('@');
    expect(out[0]).toEqual({
      id: '1', body: '[PORTAL][PORTAL:CUSTOMER]\nhi', created_at: 't1', isStaff: false, creator: { name: 'Customer' },
      replies: [{ id: '1a', body: 'reply', created_at: 't2', isStaff: true, creator: { name: 'Summit Sensory Gym' } }],
    });
  });

  it('preserves the legacy email-based staff guess via isStaff', () => {
    const out = customerVisibleMessages(updates);
    expect(out[1].isStaff).toBe(true);
    // The client helpers read the precomputed flag once emails are stripped.
    expect(isStaffMessage(out[1])).toBe(true);
    expect(isStaffReply(out[0].replies[0])).toBe(true);
    expect(isStaffMessage(out[0])).toBe(false);
  });

  it('an explicit origin tag still beats the flag', () => {
    expect(isStaffMessage({ body: '[PORTAL][PORTAL:CUSTOMER]\nx', isStaff: true })).toBe(false);
  });
});
