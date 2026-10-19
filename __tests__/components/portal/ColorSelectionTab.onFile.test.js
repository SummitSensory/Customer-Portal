// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ColorSelectionTab from '../../../components/portal/ColorSelectionTab';

// Audit follow-up 2026-10-18: an order whose colors came in through the
// earlier Jotform form showed "Done" in the sidebar but an editable picker in
// the tab. It now shows a read-only "on file" card instead.
function stubGet(body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { supported: true, selections: {}, confirmedAt: null, totalUpcharge: null, staffCollecting: [] };
const inputs = [{ input: 'structure_frame_paint', label: 'Structure & Frame Paint', parts: ['legs'] }];

describe('ColorSelectionTab — colors on file outside the portal', () => {
  it('shows a read-only "on file" card instead of the picker', async () => {
    stubGet({ ...base, requiredInputs: inputs, onFile: 'received' });
    const markComplete = vi.fn();
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={markComplete} showToast={() => {}} />);
    expect(await screen.findByText('Your color selections are on file')).toBeTruthy();
    expect(screen.queryByText('Structure & Frame Paint')).toBeNull();
    expect(markComplete).toHaveBeenCalledWith('color', true);
  });

  it('says no selections are needed when the step is N/A', async () => {
    stubGet({ ...base, requiredInputs: [], onFile: 'not_applicable' });
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={() => {}} showToast={() => {}} />);
    expect(await screen.findByText('No color selections needed')).toBeTruthy();
  });

  it('offers staff (View as Customer) a change button on colors on file; never the customer', async () => {
    stubGet({ ...base, requiredInputs: inputs, onFile: 'received', canOverride: true });
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={() => {}} showToast={() => {}} />);
    fireEvent.click(await screen.findByText('✏️ Change colors (staff)'));
    expect(screen.getByText('Staff change.')).toBeTruthy();
    expect(screen.getByText('Structure & Frame Paint')).toBeTruthy();
    cleanup();

    stubGet({ ...base, requiredInputs: inputs, onFile: 'received', canOverride: false });
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={() => {}} showToast={() => {}} />);
    await screen.findByText('Your color selections are on file');
    expect(screen.queryByText('✏️ Change colors (staff)')).toBeNull();
  });

  it('staff can open a confirmed order for a change and cancel back to the locked view', async () => {
    const confirmed = { structure_frame_paint: { legs: { brand: 'cardinal', code: 'T009-BG01' } } };
    stubGet({ ...base, requiredInputs: inputs, selections: confirmed, confirmedAt: '2026-10-01T12:00:00.000Z', totalUpcharge: 0, onFile: null, canOverride: true });
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={() => {}} showToast={() => {}} />);
    fireEvent.click(await screen.findByText('✏️ Change colors (staff)'));
    expect(screen.queryByText(/these selections are locked/)).toBeNull();
    fireEvent.click(screen.getByText('Cancel change'));
    expect(screen.getByText(/these selections are locked/)).toBeTruthy();
  });

  it('tells the customer staff will collect a part the portal has no picker for', async () => {
    stubGet({ ...base, requiredInputs: [], onFile: null, staffCollecting: ['Ball Pit Ball Colors'] });
    render(<ColorSelectionTab order={{ id: 'o1' }} completions={{}} markComplete={() => {}} showToast={() => {}} />);
    expect(await screen.findByText('Nothing to pick here')).toBeTruthy();
    expect(screen.getByText(/Ball Pit Ball Colors/)).toBeTruthy();
  });
});
