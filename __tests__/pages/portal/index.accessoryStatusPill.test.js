import { describe, it, expect } from 'vitest';
import { accessoryStatusPill } from '../../../pages/portal/index';

// PORTAL-065: accessoryStatusPill used to label an item "✓ SHIPPED" purely
// from carrier+tracking-number presence, without checking AfterShip's own
// early-stage status (Pending/Info Received, already stored in
// item.carrierStatus) — producing a self-contradicting display (a green
// "✓ SHIPPED" pill next to a live "Pending" status one click away). Fixed
// to also treat those two early tags as not-yet-shipped.
describe('accessoryStatusPill', () => {
  it('shows LABEL CREATED (not SHIPPED) when tracking exists but the carrier status is still Pending', () => {
    const pill = accessoryStatusPill({ carrierStatus: 'Pending' }, true);
    expect(pill.label).toBe('LABEL CREATED');
  });

  it('shows LABEL CREATED (not SHIPPED) when tracking exists but the carrier status is Info Received', () => {
    const pill = accessoryStatusPill({ carrierStatus: 'Info Received' }, true);
    expect(pill.label).toBe('LABEL CREATED');
  });

  it('shows ✓ SHIPPED once the carrier has a real in-transit status', () => {
    const pill = accessoryStatusPill({ carrierStatus: 'In Transit' }, true);
    expect(pill.label).toBe('✓ SHIPPED');
  });

  it('shows ✓ SHIPPED when carrierStatus is entirely unset but tracking exists (no regression on the common case)', () => {
    const pill = accessoryStatusPill({}, true);
    expect(pill.label).toBe('✓ SHIPPED');
  });

  it('still shows ✓ DELIVERED for a genuinely delivered item — the pre-existing check is untouched', () => {
    const pill = accessoryStatusPill({ carrierStatus: 'Delivered' }, true);
    expect(pill.label).toBe('✓ DELIVERED');
  });

  it('falls through to the order-status pills when there is no tracking at all', () => {
    expect(accessoryStatusPill({ orderStatus: 'Out of Stock' }, false).label).toBe('OUT OF STOCK');
    expect(accessoryStatusPill({ orderStatus: 'Ordered' }, false).label).toBe('ORDERED');
    expect(accessoryStatusPill({}, false).label).toBe('ORDER PENDING');
  });
});
