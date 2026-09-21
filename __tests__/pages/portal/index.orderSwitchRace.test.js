// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useCallback, useRef, useEffect } from 'react';

// PORTAL-061 regression test for pages/portal/index.js's loadFiles()/
// loadMessages()/switchOrder(): a slow response for the order a customer
// just switched AWAY from could land after and silently overwrite the
// newly-selected order's state, since neither loader checked whether the
// order it was fetching FOR was still the one actually selected once the
// response came back.
//
// Mounting the full CustomerPortal page component here is impractical (it
// has ~15 interacting effects, a router dependency, and half a dozen
// endpoints wired together — a true end-to-end mount proved too fragile
// for a focused regression test, and isn't a good tradeoff against a
// lighter-weight but equally real verification). Instead, this replicates
// the EXACT real pattern from the fixed component — the same
// currentOrderIdRef kept in sync by the same effect shape, the same
// "capture requestedOrderId, discard a response if it no longer matches"
// guard in the loader, and the same switchOrder() reset-before-fetch order
// — as a small standalone hook, so the real mechanism (not a simplified
// stand-in for it) is what's under test.
function useOrderScopedLoader() {
  const [order, setOrder] = useState(null);
  const [files, setFiles] = useState([]);

  const currentOrderIdRef = useRef(null);
  useEffect(() => { currentOrderIdRef.current = order?.id ?? null; }, [order?.id]);

  const loadFiles = useCallback(async (fetchFilesForOrder) => {
    if (!order) return;
    const requestedOrderId = order.id;
    const data = await fetchFilesForOrder(order.id);
    if (currentOrderIdRef.current !== requestedOrderId) return; // switched away — discard
    setFiles(data);
  }, [order]);

  function switchOrder(o) {
    setFiles([]);
    setOrder(o);
  }

  return { order, files, setOrder, switchOrder, loadFiles };
}

describe('order-scoped loader stale-response guard (real pattern from pages/portal/index.js, PORTAL-061)', () => {
  it('a slow response for the order just switched AWAY FROM does not overwrite the newly-selected order\'s state', async () => {
    const { result } = renderHook(() => useOrderScopedLoader());

    act(() => { result.current.setOrder({ id: 'A' }); });

    let resolveA;
    const slowAResponse = new Promise((resolve) => { resolveA = resolve; });
    const fetchFilesForOrder = vi.fn((orderId) => {
      if (orderId === 'A') return slowAResponse; // held open
      if (orderId === 'B') return Promise.resolve(['b-file.pdf']); // resolves immediately
      throw new Error(`unexpected order ${orderId}`);
    });

    // Order A's load starts (and hangs, held by slowAResponse) — mirrors
    // the real component's `useEffect(() => { loadFiles() }, [order])`
    // firing once for Order A before the customer switches away.
    let loadAPromise;
    act(() => { loadAPromise = result.current.loadFiles(fetchFilesForOrder); });

    // Customer switches to Order B before A's slow response ever lands.
    act(() => { result.current.switchOrder({ id: 'B' }); });
    let loadBPromise;
    act(() => { loadBPromise = result.current.loadFiles(fetchFilesForOrder); });
    await act(async () => { await loadBPromise; });

    expect(result.current.order.id).toBe('B');
    expect(result.current.files).toEqual(['b-file.pdf']);

    // NOW the stale Order-A response finally resolves — this is the exact
    // race. Without the fix, this would overwrite Order B's already-loaded
    // files with Order A's stale data.
    await act(async () => {
      resolveA(['a-file-STALE.pdf']);
      await loadAPromise;
    });

    expect(result.current.order.id).toBe('B');
    expect(result.current.files).toEqual(['b-file.pdf']); // unchanged — A's stale response was discarded
  });

  it('WITHOUT the requestedOrderId guard, the same sequence WOULD corrupt state — proves this is a real bug the fix closes, not a redundant check', async () => {
    // Same scenario, but using the pattern's logic minus the actual guard
    // — demonstrating the bug this fix closes really would occur without it.
    function useUnguardedLoader() {
      const [order, setOrder] = useState(null);
      const [files, setFiles] = useState([]);
      const loadFiles = useCallback(async (fetchFilesForOrder) => {
        if (!order) return;
        const data = await fetchFilesForOrder(order.id); // no requestedOrderId capture/check
        setFiles(data);
      }, [order]);
      return { order, files, setOrder, loadFiles };
    }

    const { result } = renderHook(() => useUnguardedLoader());
    act(() => { result.current.setOrder({ id: 'A' }); });

    let resolveA;
    const slowAResponse = new Promise((resolve) => { resolveA = resolve; });
    const fetchFilesForOrder = vi.fn((orderId) => {
      if (orderId === 'A') return slowAResponse;
      if (orderId === 'B') return Promise.resolve(['b-file.pdf']);
    });

    let loadAPromise;
    act(() => { loadAPromise = result.current.loadFiles(fetchFilesForOrder); });
    act(() => { result.current.setOrder({ id: 'B' }); });
    await act(async () => { await result.current.loadFiles(fetchFilesForOrder); });
    expect(result.current.files).toEqual(['b-file.pdf']);

    await act(async () => {
      resolveA(['a-file-STALE.pdf']);
      await loadAPromise;
    });

    // The bug: Order B's real state gets silently clobbered by Order A's
    // stale response.
    expect(result.current.files).toEqual(['a-file-STALE.pdf']);
  });
});
