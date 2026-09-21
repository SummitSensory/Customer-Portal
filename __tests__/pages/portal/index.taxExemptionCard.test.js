// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaxExemptionCard } from '../../../pages/portal/index';

// PORTAL-066: chooseNo() optimistically flipped the UI to "No" before the
// Monday write confirmed, and — unlike the sibling toggleFreightNotify()
// pattern elsewhere in this file — never reverted that optimistic choice
// on a failed save, so a customer whose save actually failed was left
// looking at "No, we are not tax-exempt" selected/highlighted with no
// indication it never actually saved. Fixed by capturing the
// pre-optimistic value and reverting to it in the catch block.
describe('TaxExemptionCard.chooseNo() — revert on failed save (PORTAL-066)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function order() {
    return { id: 'order-1', taxExemptStatus: null };
  }

  it('stays selected (btn-moss) once the save actually succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<TaxExemptionCard order={order()} showToast={() => {}} onRefresh={() => {}} />);
    const noButton = screen.getByRole('button', { name: /No, we are not tax-exempt/ });
    await user.click(noButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(noButton.className).toMatch(/btn-moss/));
  });

  it('REVERTS the optimistic "No" selection when the save actually fails — the real fix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Monday write failed' }) });
    vi.stubGlobal('fetch', fetchMock);
    const toasts = [];
    const user = userEvent.setup();

    render(<TaxExemptionCard order={order()} showToast={(msg) => toasts.push(msg)} onRefresh={() => {}} />);
    const noButton = screen.getByRole('button', { name: /No, we are not tax-exempt/ });

    // userEvent.click awaits through the whole optimistic-update-then-
    // revert microtask chain (the mock fetch rejects effectively
    // synchronously), so by the time this resolves the fix has already
    // had its chance to (correctly) revert. The real assertion is the
    // settled state below: it must show as REVERTED (btn-ghost), not
    // still selected (btn-moss) — proving the catch block's revert
    // actually ran rather than leaving the optimistic value in place.
    await user.click(noButton);

    await waitFor(() => expect(noButton.className).not.toMatch(/btn-moss/));
    expect(noButton.className).toMatch(/btn-ghost/);
    expect(toasts.some((t) => /error/i.test(t))).toBe(true);
  });
});
