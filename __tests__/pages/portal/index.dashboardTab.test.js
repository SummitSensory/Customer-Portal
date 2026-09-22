// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DashboardTab } from '../../../pages/portal/index';

// PORTAL-064: hasSeenDashboardBefore used to be read in a useEffect, which
// only runs AFTER the first paint, while the incomplete-items banner it
// gates was computed synchronously from props every render — switching
// orders (or landing fresh) while staying on the Dashboard tab meant the
// very first paint for a new order.id still reflected the PREVIOUS order's
// "seen" state, briefly showing the wrong order's first-visit banner
// before the effect corrected it a tick later. Fixed with a useMemo that
// reads localStorage synchronously during render, keyed on order.id.
describe('DashboardTab — return-visit incomplete-items banner (PORTAL-064)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  const baseProps = {
    order: { id: 'order-A', firstName: 'Jane', name: 'Order A' },
    completions: {},
    setupCount: 3,
    setupTotal: 5,
    onNav: () => {},
  };

  it('does NOT show the banner on a genuine first visit, even when setup is incomplete', () => {
    render(<DashboardTab {...baseProps} setupComplete={false} />);
    expect(screen.queryByText(/still incomplete/)).not.toBeInTheDocument();
  });

  it('marks the order as seen after the first render, so a SECOND mount shows the banner', () => {
    const { unmount } = render(<DashboardTab {...baseProps} setupComplete={false} />);
    unmount();
    render(<DashboardTab {...baseProps} setupComplete={false} />);
    expect(screen.getByText(/2 items still incomplete/)).toBeInTheDocument();
  });

  it('never shows the banner once setup is actually complete, even on a return visit', () => {
    const { unmount } = render(<DashboardTab {...baseProps} setupComplete={false} />);
    unmount();
    render(<DashboardTab {...baseProps} setupComplete setupCount={5} />);
    expect(screen.queryByText(/still incomplete/)).not.toBeInTheDocument();
  });

  // The actual regression: switching to a genuinely never-viewed order
  // while the SAME DashboardTab instance stays mounted (a prop change, not
  // a fresh mount/unmount) must still correctly treat the new order as a
  // first visit on its very first render — not carry over the previous
  // order's "seen" state, which is exactly what the old useEffect-based
  // read did (async correction, one render late).
  it('switching to a genuinely never-viewed order (same mounted instance) does NOT show the banner on the very first render for that order', () => {
    // Order A has already been "seen" (pre-populate the same way the
    // component's own effect would have on an earlier visit).
    localStorage.setItem('summit_dashboard_seen_order-A', 'true');

    const { rerender } = render(<DashboardTab {...baseProps} setupComplete={false} />);
    expect(screen.getByText(/2 items still incomplete/)).toBeInTheDocument();

    // Switch to Order B — never viewed before, also incomplete. This must
    // NOT show the banner on this same render pass.
    rerender(
      <DashboardTab
        {...baseProps}
        order={{ id: 'order-B', firstName: 'Jane', name: 'Order B' }}
        setupComplete={false}
      />
    );
    expect(screen.queryByText(/still incomplete/)).not.toBeInTheDocument();
  });

  it('shows the correct singular/plural item count', () => {
    const { unmount } = render(<DashboardTab {...baseProps} setupComplete={false} setupCount={4} />);
    unmount();
    render(<DashboardTab {...baseProps} setupComplete={false} setupCount={4} />);
    expect(screen.getByText(/1 item still incomplete/)).toBeInTheDocument();
  });
});
