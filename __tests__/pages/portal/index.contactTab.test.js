// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactTab } from '../../../pages/portal/index';

// PORTAL-062: ContactTab.confirm() used to gate ONLY on the raw, read-only
// Monday-mirror props (order.contactName/Phone/Email), which never update
// from inside the portal (a contact update only posts a note for staff
// review). A brand-new order with blank mirrors auto-opens edit mode so the
// customer can fill them in — but once they did, and submitted, "Confirm &
// Continue" still failed against the never-changing blank mirror props and
// bounced them right back into edit mode with a false error, an
// unbreakable loop for exactly the scenario this component exists to
// handle. Fixed to also accept a submitted pendingUpdate or fully-filled
// local form state.
describe('ContactTab.confirm() — auto-edit-mode customers can actually confirm (PORTAL-062)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function newOrderWithBlankMirrors() {
    return { id: 'order-new', name: 'Acme Gym - Order 1', contactName: '', contactPhone: '', contactEmail: '' };
  }

  it('a brand-new order auto-opens in edit mode (the pre-existing, documented behavior)', () => {
    render(<ContactTab order={newOrderWithBlankMirrors()} completions={{}} markComplete={() => {}} showToast={() => {}} onNext={() => {}} />);
    expect(screen.getByRole('button', { name: /Submit Changes/ })).toBeInTheDocument();
  });

  it('after submitting contact info, "Confirm & Continue" succeeds instead of bouncing back to a false error — the actual fix', async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.tab === 'contact_update') return { ok: true, json: async () => ({ ok: true }) };
      if (body.tab === 'contact') return { ok: true, json: async () => ({ ok: true, checklistSyncPending: false }) };
      throw new Error(`unexpected tab: ${body.tab}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const toasts = [];
    const onNext = vi.fn();
    const markComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <ContactTab
        order={newOrderWithBlankMirrors()}
        completions={{}}
        markComplete={markComplete}
        showToast={(msg) => toasts.push(msg)}
        onNext={onNext}
      />
    );

    // The form's <label> elements are siblings of their <input>, not
    // wrapping them, and carry no htmlFor/id pairing — getByLabelText
    // can't associate them, so query by each input's distinct placeholder
    // instead.
    await user.type(screen.getByPlaceholderText('Full name'), 'Jane Doe');
    await user.type(screen.getByPlaceholderText('email@example.com'), 'jane@example.com');
    await user.type(screen.getByPlaceholderText('+1 303 555 0100'), '303-555-0100');
    await user.click(screen.getByRole('button', { name: /Submit Changes/ }));

    // Submission succeeded and the pending-review banner is now showing —
    // confirms the customer's real state, not just that the click fired.
    await waitFor(() => expect(screen.getByText(/pending review/)).toBeInTheDocument());

    // This is the actual regression: click "Confirm & Continue" and verify
    // it succeeds instead of re-opening edit mode with a false error.
    await user.click(screen.getByRole('button', { name: /Confirm & Continue/ }));

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(markComplete).toHaveBeenCalledWith('contact', true);
    expect(toasts).not.toContain('Please complete all required contact fields before continuing.');
    // Must NOT have been kicked back into edit mode.
    expect(screen.queryByRole('button', { name: /Submit Changes/ })).not.toBeInTheDocument();
  });

  it('still blocks confirm with the real error when there is truly no contact info anywhere (no regression)', async () => {
    const toasts = [];
    const onNext = vi.fn();
    const user = userEvent.setup();

    render(
      <ContactTab
        order={newOrderWithBlankMirrors()}
        completions={{}}
        markComplete={() => {}}
        showToast={(msg) => toasts.push(msg)}
        onNext={onNext}
      />
    );

    // Don't fill anything in — go straight to Confirm & Continue while
    // still in edit mode with blank fields.
    await user.click(screen.getByRole('button', { name: /Confirm & Continue/ }));

    expect(onNext).not.toHaveBeenCalled();
    expect(toasts).toContain('Please complete all required contact fields before continuing.');
  });
});
