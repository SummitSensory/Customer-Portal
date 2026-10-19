import { describe, it, expect } from 'vitest';
import { diffSelections, upchargeChangeText, overrideAuditText, colorHistoryFromUpdates } from '../../lib/colorSelectionChanges';

const inputs = [{ input: 'structure_frame_paint', label: 'Structure & Frame Paint', parts: ['legs', 'horizontal_beams'] }];

describe('diffSelections', () => {
  it('lists only the parts whose brand or code changed, with readable labels', () => {
    const before = { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' }, horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' } } };
    const after = { structure_frame_paint: { legs: { brand: 'prismatic', code: 'PRB-11039' }, horizontal_beams: { brand: 'cardinal', code: 'T009-BG01' } } };
    const changes = diffSelections(inputs, before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ part: 'legs', partLabel: 'Legs', inputLabel: 'Structure & Frame Paint' });
    expect(changes[0].from).toContain('T009-BG01');
    expect(changes[0].to).toContain('PRB-11039');
  });

  it('treats a part with no earlier pick as new (from: null)', () => {
    const changes = diffSelections(inputs, {}, { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } } });
    expect(changes).toEqual([expect.objectContaining({ part: 'legs', from: null })]);
  });
});

describe('upchargeChangeText', () => {
  it('shows the difference both ways', () => {
    expect(upchargeChangeText(0, 500)).toBe('$0 → $500 (+$500)');
    expect(upchargeChangeText(800, 500)).toBe('$800 → $500 (−$300)');
    expect(upchargeChangeText(500, 500)).toBe('$500 (unchanged)');
    expect(upchargeChangeText(null, 500)).toBe('$500 (no earlier portal total)');
  });
});

describe('colorHistoryFromUpdates', () => {
  it('keeps only color confirmations and changes, newest first, as lines of text', () => {
    const audit = overrideAuditText({
      staffEmail: 'kyle@summitsensory.com', reason: 'Called in', previousTotal: 0, newTotal: 0, at: new Date('2026-10-19T15:00:00Z'),
      changes: [{ inputLabel: 'Structure & Frame Paint', partLabel: 'Legs', from: 'Black', to: 'Navy' }],
    });
    // Monday stores line breaks as <br> and escapes &.
    const updates = [
      { id: 1, created_at: '2026-10-01T00:00:00Z', body: '[PORTAL: Color Selections]<br>Customer confirmed color/finish selections on 10/1/2026. Total upcharge: $0.' },
      { id: 2, created_at: '2026-10-05T00:00:00Z', body: '[PORTAL: Staff Viewing As Customer]<br>kyle started viewing' },
      { id: 3, created_at: '2026-10-19T15:00:00Z', body: `[PORTAL: Color Selections Changed]<br>${audit.replace(/&/g, '&amp;').replace(/\n/g, '<br>')}` },
    ];
    const history = colorHistoryFromUpdates(updates);
    expect(history.map((h) => h.kind)).toEqual(['changed', 'confirmed']);
    expect(history[0].lines).toContain('Reason: Called in');
    expect(history[0].lines).toContain('Structure & Frame Paint — Legs: Black → Navy');
  });
});
