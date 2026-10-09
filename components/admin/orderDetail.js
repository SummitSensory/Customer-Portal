// The admin Orders list comes from getAllOrders(), which deliberately leaves
// out mirror columns (adding them caused the 2026-09-24 outage). Anything
// derived from a mirror — the color gates, contact/POC fields — was blank in
// the list, and the Colors panel computed the wrong required parts from it.
// The dashboard now loads the full getOrderById() record per row on demand
// (GET /api/monday/orders?id=) and overlays it with withDetail().

// Fields parseOrderItem derives only from mirror columns.
export const MIRROR_DERIVED_FIELDS = [
  'colorGates', 'colorFrameType', 'phone', 'pocName', 'pocEmail', 'firstName',
  'contactName', 'contactEmail', 'contactPhone', 'deliveryInstructions',
  'billingAddressOnFile', 'billingZipOnFile',
];

// Mirror columns the admin table maps to a parsed field (getCellValue's
// knownMap) — blank until the row's detail is loaded.
export const MIRROR_TABLE_COL_IDS = new Set([
  'lookup_mkwaee43', // phone
  'lookup_mkwb5bty', // pocName
  'lookup_mkwazctw', // pocEmail
  'lookup_mkvx85hs', // firstName
  'lookup_mm0anh5a', // deliveryInstructions
]);

/**
 * Overlay a lazily-loaded full order onto its list row — mirror-derived
 * fields only, so a detail fetched earlier never masks a fresher list value
 * (status, tracking, balance) after a save + refresh.
 */
export function withDetail(listOrder, detail) {
  if (!detail) return listOrder;
  const merged = { ...listOrder };
  for (const f of MIRROR_DERIVED_FIELDS) {
    if (detail[f] !== undefined) merged[f] = detail[f];
  }
  return merged;
}
