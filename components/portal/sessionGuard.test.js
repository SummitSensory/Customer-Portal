// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installOrderOwnershipGuard } from './sessionGuard';

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('installOrderOwnershipGuard', () => {
  let uninstall = () => {};
  afterEach(() => { uninstall(); vi.unstubAllGlobals(); });

  it('signs out once on a 401 ORDER_NOT_OWNED from an /api/ call, leaving the body readable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { error: 'x', code: 'ORDER_NOT_OWNED' })));
    const onLost = vi.fn();
    uninstall = installOrderOwnershipGuard(onLost);

    const res = await window.fetch('/api/monday/messages?orderId=1');
    await window.fetch('/api/monday/files?orderId=1');

    expect(onLost).toHaveBeenCalledTimes(1);
    expect((await res.json()).code).toBe('ORDER_NOT_OWNED');
  });

  it('ignores a plain 401 (not authenticated) and other errors', async () => {
    const onLost = vi.fn();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(401, { error: 'Not authenticated.' }))
      .mockResolvedValueOnce(response(409, { code: 'ORDER_MISMATCH' }))
      .mockResolvedValueOnce(response(200, { ok: true })));
    uninstall = installOrderOwnershipGuard(onLost);

    await window.fetch('/api/monday/order');
    await window.fetch('/api/portal/setup', { method: 'POST' });
    await window.fetch('/api/monday/order');

    expect(onLost).not.toHaveBeenCalled();
  });

  it('ignores responses from other origins', async () => {
    const onLost = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { code: 'ORDER_NOT_OWNED' })));
    uninstall = installOrderOwnershipGuard(onLost);
    await window.fetch('https://example.com/api/thing');
    expect(onLost).not.toHaveBeenCalled();
  });

  it('uninstall restores the original fetch', () => {
    const original = vi.fn();
    vi.stubGlobal('fetch', original);
    installOrderOwnershipGuard(vi.fn())();
    expect(window.fetch).toBe(original);
  });
});
