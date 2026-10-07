// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ColorSelectionTab, { ORDER_MISMATCH_MESSAGE } from './ColorSelectionTab';
import { COLOR_INPUT } from '../../lib/colorRequirements';

// AUDIT-2026-10-06: ColorSelectionTab's handling of the server's 409s
// (ALREADY_CONFIRMED -> locked view, ORDER_MISMATCH -> reload message),
// orderId on every save, and ContinueBar showing the real save status.

const REQUIRED = [{ input: COLOR_INPUT.MAT_PAD_COLOR, label: 'Mat & Pad Color', parts: ['color'] }];

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// postHandler(body) -> response (or a promise of one); GETs return `getBody()`.
function stubFetch(postHandler, getBody = () => ({ requiredInputs: REQUIRED, selections: {}, confirmedAt: null })) {
  const posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    if (opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      return postHandler(body);
    }
    return jsonRes(200, getBody());
  }));
  return posts;
}

async function openPickerAndPickFirstSwatch(user) {
  await user.click(await screen.findByRole('button', { name: /Mat & Pad Color/ }));
  await user.click(screen.getByRole('button', { name: /Choose a color/ }));
  const options = screen.getAllByRole('option');
  await user.click(options[0]);
}

function renderTab(props = {}) {
  const toasts = [];
  const markComplete = vi.fn();
  render(
    <ColorSelectionTab
      order={{ id: 'order-1' }}
      completions={{}}
      markComplete={markComplete}
      showToast={(m) => toasts.push(m)}
      onNext={() => {}}
      onBack={() => {}}
      {...props}
    />
  );
  return { toasts, markComplete };
}

describe('ColorSelectionTab — audit fixes 2026-10-06', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('sends the order id with every autosave', async () => {
    const posts = stubFetch(() => jsonRes(200, { ok: true }));
    const user = userEvent.setup();
    renderTab();
    await openPickerAndPickFirstSwatch(user);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ orderId: 'order-1', confirm: false });
  });

  it('a 409 ALREADY_CONFIRMED switches to the locked confirmed view instead of only toasting', async () => {
    let confirmedOnServer = false;
    stubFetch(
      () => { confirmedOnServer = true; return jsonRes(409, { error: 'Already confirmed.', code: 'ALREADY_CONFIRMED', confirmedAt: '2026-10-01T12:00:00.000Z' }); },
      () => ({ requiredInputs: REQUIRED, selections: {}, confirmedAt: confirmedOnServer ? '2026-10-01T12:00:00.000Z' : null })
    );
    const user = userEvent.setup();
    const { markComplete } = renderTab();
    await openPickerAndPickFirstSwatch(user);
    expect(await screen.findByText(/these selections are locked/)).toBeInTheDocument();
    expect(markComplete).not.toHaveBeenCalled();
  });

  it('a 409 ORDER_MISMATCH tells the customer to reload and reverts the pick', async () => {
    stubFetch(() => jsonRes(409, { error: 'mismatch', code: 'ORDER_MISMATCH' }));
    const user = userEvent.setup();
    const { toasts } = renderTab();
    await openPickerAndPickFirstSwatch(user);
    await waitFor(() => expect(toasts).toContain(ORDER_MISMATCH_MESSAGE));
    expect(screen.getByText(/not saved/)).toBeInTheDocument();
    expect(screen.queryByText(/✓ Selected/)).not.toBeInTheDocument();
  });

  it('ContinueBar says "saving…" until the save resolves, then "saved"', async () => {
    let resolveSave;
    stubFetch(() => new Promise((resolve) => { resolveSave = () => resolve(jsonRes(200, { ok: true })); }));
    const user = userEvent.setup();
    renderTab();
    await openPickerAndPickFirstSwatch(user);
    expect(await screen.findByText(/saving…/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select & continue/ })).toBeDisabled();
    await waitFor(() => expect(typeof resolveSave).toBe('function'));
    await act(async () => { resolveSave(); });
    expect(await screen.findByText(/— saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select & continue/ })).toBeEnabled();
  });
});
