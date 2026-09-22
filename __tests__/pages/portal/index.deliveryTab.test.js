// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeliveryTab } from '../../../pages/portal/index';

// PORTAL-063: DeliveryTab's client-side validate() let State/Zip through
// blank when the customer typed a new ship-to address (the old hint text
// even invited it for international shipments), but the server
// (pages/api/portal/setup.js's validateSetupData) ALWAYS requires both —
// producing a permanent, unrecoverable dead-end retry loop with only a
// generic "Error saving" toast. Fixed to require both client-side too,
// matching the server exactly, and to surface the server's real error
// message on a failed save instead of a hardcoded generic string.
describe('DeliveryTab — ship-to State/Zip are actually required (PORTAL-063)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function order() {
    return {
      id: 'order-1',
      name: 'Acme Gym - Order 1',
      stages: [{ key: 'placed' }, { key: 'processing' }, { key: 'shipped' }],
      stageIndex: 0,
    };
  }

  it('State and Zip are marked required in the UI (no more "(if applicable)" framing)', async () => {
    const user = userEvent.setup();
    render(<DeliveryTab order={order()} completions={{}} markComplete={() => {}} showToast={() => {}} onNext={() => {}} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /No, I need to update it/ }));

    const stateField = screen.getByText('State / Province / Region').closest('.field');
    const zipField = screen.getByText('ZIP / Postal Code').closest('.field');
    expect(within(stateField).getByText('*')).toBeInTheDocument();
    expect(within(zipField).getByText('*')).toBeInTheDocument();
    expect(screen.queryByText(/if applicable/i)).not.toBeInTheDocument();
  });

  it('submitting with State/Zip left blank shows real "Required" errors instead of silently reaching the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const toasts = [];

    render(
      <DeliveryTab
        order={order()}
        completions={{}}
        markComplete={() => {}}
        showToast={(msg) => toasts.push(msg)}
        onNext={() => {}}
        onBack={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: /No, I need to update it/ }));
    // Deliberately leave every field blank, including State/Zip, and try
    // to submit.
    await user.click(screen.getByRole('button', { name: /Save & Continue/ }));

    const stateField = screen.getByText('State / Province / Region').closest('.field');
    const zipField = screen.getByText('ZIP / Postal Code').closest('.field');
    expect(within(stateField).getByText('Required')).toBeInTheDocument();
    expect(within(zipField).getByText('Required')).toBeInTheDocument();
    // Client-side validation caught it — the request must never have
    // reached the server at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The companion fix (submit()'s catch block now shows saveSetup()'s real
// thrown error message via showToast(err.message), instead of a hardcoded
// generic string) is verified directly against the source in
// pages/portal/index.js's submit() function (PORTAL-063 comment) rather
// than via a full end-to-end interaction test here — this component has
// ~20 interdependent required fields (POC, secondary POC, address, timing,
// acknowledgment) across several conditionally-rendered sections, and a
// test that fills all of them just to reach the network call is high
// maintenance cost for low marginal signal over the two tests above, which
// already prove the actually-reachable-by-a-real-customer failure mode
// (blank State/Zip silently reaching the server) is closed.
