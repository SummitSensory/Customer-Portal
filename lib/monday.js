/**
 * Monday.com GraphQL client and helpers.
 * All column IDs are read from environment variables so they can be
 * reconfigured from the Admin Settings without touching code.
 */

const MONDAY_API = 'https://api.monday.com/v2';

// Label the portal writes to mark a checklist section complete.
// Must match the "complete" label configured on the Status columns in Monday.
const PORTAL_DONE_LABEL = process.env.MONDAY_PORTAL_DONE_LABEL || '✅';

// ── Column ID map — confirmed against Manufacturing Process board (ID: 6533700776)
export const COLS = {
  customerEmail:  process.env.MONDAY_COL_CUSTOMER_EMAIL  || 'email__1',           // "Email Address" (email)
  status:         process.env.MONDAY_COL_STATUS           || 'status__1',          // "Manufacturing Phase" (status)
  trackingNumber: process.env.MONDAY_COL_TRACKING_NUMBER  || 'lookup_mm1kcbb5',   // "GB FedEx Tracking Number" (mirror, read-only)
  freightTracking:process.env.MONDAY_COL_FREIGHT_TRACKING || 'dup__of_gb_production7__1', // "Freight Tracking ID" (mirror, read-only)
  portalFiles:    process.env.MONDAY_COL_PORTAL_FILES     || 'file_mm4wbdrh',     // "Portal Files" (file)
  invoiceLink:    process.env.MONDAY_COL_INVOICE_LINK     || 'text_mm4wfamc',     // "Link to Customer Invoice" (text/URL)
  paymentLink:    process.env.MONDAY_COL_PAYMENT_LINK     || '',                  // "Payment Portal URL" (text/URL)
  shipDate:       process.env.MONDAY_COL_SHIP_DATE        || 'date_mkvvpex1',     // "Initial Projected Ship Date" (date)
  address:        process.env.MONDAY_COL_ADDRESS          || 'long_text_mkpkdtj4',// "Confirmed Delivery Address" (long_text)
  productType:    process.env.MONDAY_COL_PRODUCT_TYPE     || 'color_mkvw7b8',     // "Product Series STD Column" (status)
  // Additional shipment tracking (comma-separated tracking numbers; set col IDs via env vars)
  matTracking:        process.env.MONDAY_COL_MAT_TRACKING         || '', // Mat/pad FedEx tracking numbers (comma-separated)
  otherShipments:     process.env.MONDAY_COL_OTHER_SHIPMENTS      || '', // Additional items: "Label|Carrier|Tracking" per line
  // Installation content (set col IDs via env vars once columns are added to Monday board)
  installationVideos: process.env.MONDAY_COL_INSTALLATION_VIDEOS  || '', // YouTube/Vimeo URLs (comma-separated)
  installationDocs:   process.env.MONDAY_COL_INSTALLATION_DOCS    || '', // Doc links: "Label|URL" per entry (comma-separated)
  installationLinks:  process.env.MONDAY_COL_INSTALLATION_LINKS   || 'text_mm4x6xvf', // Resource links: "Label|URL" per line (newline-separated)
  // Color selection form — direct writable text column (reliable)
  colorFormDirect: process.env.MONDAY_COL_COLOR_FORM_URL || 'text_mm4y44dt',
  // Legacy mirror column kept as last-resort fallback
  colorFormId:    'lookup_mm4xws1a',
  // Photo/Video Showcase form — direct writable text column (same pattern as colorFormDirect)
  showcaseFormDirect: process.env.MONDAY_COL_SHOWCASE_FORM_URL || 'text_mm59x2cb',
  // Portal onboarding checklist — Status columns (✅ = complete / 🚫 = incomplete)
  portalContact:   process.env.MONDAY_COL_PORTAL_CONTACT   || 'color_mm4ybgaa', // "Portal: Contact"
  portalBilling:   process.env.MONDAY_COL_PORTAL_BILLING   || 'color_mm51e5w9', // "Portal: Billing"
  portalDelivery:  process.env.MONDAY_COL_PORTAL_DELIVERY  || 'color_mm51j15w', // "Portal: Delivery & Freight Ack"
  portalColors:    process.env.MONDAY_COL_PORTAL_COLORS    || 'color_mm51hjph', // "Portal: Color Selections"
  portalDocuments: process.env.MONDAY_COL_PORTAL_DOCUMENTS || 'color_mm51yqbz', // "Portal: Documents"
  // AfterShip tracking inputs (writable text) — slug + tracking number per shipment
  frameCarrierSlug: process.env.MONDAY_COL_FRAME_SLUG     || 'text_mm538vtm', // Sensory Gym Frame — AfterShip slug
  frameTrackingId:  process.env.MONDAY_COL_FRAME_TRACKING || 'text_mm53p3b2', // Sensory Gym Frame — tracking number
  matsCarrierSlug:  process.env.MONDAY_COL_MATS_SLUG      || 'text_mm51pap1', // Therapy Mats & Padding — AfterShip slug
  matsTrackingId:   process.env.MONDAY_COL_MATS_TRACKING  || 'text_mm51wdm5', // Therapy Mats & Padding — tracking number
  // Mirror columns (read-only — sourced from connected boards)
  phone:          'lookup_mkwaee43',    // "POC Phone"
  pocName:        'lookup_mkwb5bty',   // "Delivery POC Name"
  pocEmail:       'lookup_mkwazctw',   // "POC Email"
  firstName:      'lookup_mkvx85hs',   // "First Name"
  deliveryInstructions: 'lookup_mm0anh5a', // "Special Delivery Instructions"
  // Contact Information tab — Primary Contact (distinct from Delivery POC mirrors above)
  contactName:    process.env.MONDAY_COL_CONTACT_NAME  || 'lookup6__1',          // Primary Contact — Name (mirror)
  contactEmail:   process.env.MONDAY_COL_CONTACT_EMAIL || 'dup__of_contact8__1', // Primary Contact — Email (mirror)
  contactPhone:   process.env.MONDAY_COL_CONTACT_PHONE || 'dup__of_contact7__1', // Primary Contact — Phone (mirror)
  // Billing Information tab — Bill-To Address, pulled from Manufacturing Process board
  billingAddressOnFile: process.env.MONDAY_COL_BILLING_ADDRESS || 'lookup18__1',          // Bill-to address (mirror)
  billingZipOnFile:     process.env.MONDAY_COL_BILLING_ZIP     || 'dup__of_location__1',  // Bill-to zip/postal code (mirror)
  // Writable — full formatted address the customer confirmed/submitted via the Billing
  // Information tab. Updates instantly on submit (no staff review step) and takes
  // precedence over the (read-only) mirror columns above for display + as the default
  // ship-to address on the Delivery Logistics tab. Created 2026-07-16.
  billingAddressConfirmed: process.env.MONDAY_COL_BILLING_ADDRESS_CONFIRMED || 'long_text_mm5a1xck',
};

// ── Delivery & Site Details Submissions board — standalone log board ─────────
// One item per portal delivery/site-details submission (secondary POC, loading
// dock, delivery timing, ship-to address confirm/update, freight ack). Created
// 2026-07-13 via the monday.com API. Board & column IDs default to the live
// values but can be overridden via env vars without a code change.
export const DELIVERY_BOARD_ID = process.env.MONDAY_DELIVERY_BOARD_ID || '18421779422';

export const DELIVERY_COLS = {
  orderItemId:          process.env.MONDAY_DEL_COL_ORDER_ITEM_ID    || 'text_mm571ym4',   // "Order Item ID"
  orderRecordLink:       process.env.MONDAY_DEL_COL_ORDER_LINK       || 'link_mm57qepn',    // "Order Record Link"
  customerEmail:         process.env.MONDAY_DEL_COL_CUSTOMER_EMAIL   || 'text_mm57c4dm',   // "Customer Email"
  submittedDate:         process.env.MONDAY_DEL_COL_SUBMITTED_DATE   || 'date_mm57s4r5',   // "Submitted Date"
  primaryPocName:        process.env.MONDAY_DEL_COL_PRIMARY_NAME     || 'text_mm57830j',   // "Primary POC Name"
  primaryPocPhone:       process.env.MONDAY_DEL_COL_PRIMARY_PHONE    || 'text_mm5767gr',   // "Primary POC Phone"
  primaryPocCanText:     process.env.MONDAY_DEL_COL_PRIMARY_CANTEXT  || 'boolean_mm57h4hs',// "Primary POC Can Text"
  primaryPocEmail:       process.env.MONDAY_DEL_COL_PRIMARY_EMAIL    || 'text_mm57qnte',   // "Primary POC Email"
  specialInstructions:   process.env.MONDAY_DEL_COL_INSTRUCTIONS     || 'long_text_mm57e4q',// "Special Delivery Instructions"
  hasSecondaryPoc:       process.env.MONDAY_DEL_COL_HAS_SECONDARY    || 'text_mm571zcw',   // "Has Secondary POC"
  secondaryPocName:      process.env.MONDAY_DEL_COL_SECONDARY_NAME   || 'text_mm57as86',   // "Secondary POC Name"
  secondaryPocPhone:     process.env.MONDAY_DEL_COL_SECONDARY_PHONE  || 'text_mm576cps',   // "Secondary POC Phone"
  secondaryPocCanText:   process.env.MONDAY_DEL_COL_SECONDARY_CANTEXT|| 'boolean_mm57h4a5',// "Secondary POC Can Text"
  secondaryPocEmail:     process.env.MONDAY_DEL_COL_SECONDARY_EMAIL  || 'text_mm57kmfe',   // "Secondary POC Email"
  primaryCommMethods:    process.env.MONDAY_DEL_COL_COMM_METHODS     || 'text_mm57t33w',   // "Preferred Communication Method" (Primary POC)
  primaryMobileForText:  process.env.MONDAY_DEL_COL_MOBILE           || 'text_mm5778hh',   // "Mobile Number for Texts" (Primary POC)
  secondaryCommMethods:  process.env.MONDAY_DEL_COL_SEC_COMM_METHODS || 'text_mm572ns5',   // "Secondary Preferred Communication Method"
  secondaryMobileForText:process.env.MONDAY_DEL_COL_SEC_MOBILE       || 'text_mm57wdc2',   // "Secondary Mobile Number"
  loadingDock:           process.env.MONDAY_DEL_COL_LOADING_DOCK     || 'text_mm5712dx',   // "Loading Dock at Facility"
  deliveryTiming:        process.env.MONDAY_DEL_COL_TIMING           || 'text_mm57q2s6',   // "Delivery Timing Preference"
  preferredDeliveryDate: process.env.MONDAY_DEL_COL_PREF_DATE        || 'date_mm57m9rp',   // "Preferred Delivery Date"
  addressConfirmed:      process.env.MONDAY_DEL_COL_ADDR_CONFIRMED   || 'text_mm572geh',   // "Ship-To Address Confirmed"
  addressLine1:          process.env.MONDAY_DEL_COL_ADDR1            || 'text_mm57sf21',   // "Address Line 1"
  addressLine2:          process.env.MONDAY_DEL_COL_ADDR2            || 'text_mm57mbr7',   // "Address Line 2"
  city:                  process.env.MONDAY_DEL_COL_CITY             || 'text_mm57g87z',   // "City"
  stateProvince:         process.env.MONDAY_DEL_COL_STATE            || 'text_mm57hhxm',   // "State or Province"
  postalCode:            process.env.MONDAY_DEL_COL_ZIP              || 'text_mm57wkbf',   // "ZIP or Postal Code"
  country:               process.env.MONDAY_DEL_COL_COUNTRY          || 'text_mm57n32a',   // "Country"
  formattedAddress:      process.env.MONDAY_DEL_COL_ADDR_FORMATTED   || 'long_text_mm57vhh3',// "Full Ship-To Address Formatted"
  freightAckBy:          process.env.MONDAY_DEL_COL_ACK_BY           || 'text_mm57nnck',   // "Freight Ack Signed By"
  freightAckDate:        process.env.MONDAY_DEL_COL_ACK_DATE         || 'date_mm578gmh',   // "Freight Ack Date"
  restrictedChanges:     process.env.MONDAY_DEL_COL_RESTRICTED       || 'long_text_mm57r7b1',// "Changes Requiring Staff Confirmation"
  staffReviewed:         process.env.MONDAY_DEL_COL_STAFF_REVIEWED   || 'boolean_mm576c3b',// "Staff Reviewed"
};

// ── Therapy Equipment & Accessories — Monday subitems board ───────────────────
// Subitems live under each order on the Manufacturing Process board (via its
// built-in "Subitems" column) rather than in a single ever-growing text column
// (the old DS-12/otherShipments approach). Each subitem = one misc/accessory
// product Summit purchases on the customer's behalf. Board ID discovered via
// the "subitems" column's settings_str (boardIds) on board 6533700776.
export const ACCESSORY_BOARD_ID = process.env.MONDAY_ACCESSORY_BOARD_ID || '6533701061';

export const ACCESSORY_COLS = {
  // "Order Status" (status): Order Pending (default) / Ordered / Out of Stock — staff-managed
  orderStatus:    process.env.MONDAY_ACC_COL_ORDER_STATUS  || 'color_mm58wahg',
  // "Date Ordered" (date) — set by staff when they flip Order Status to Ordered
  dateOrdered:    process.env.MONDAY_ACC_COL_DATE_ORDERED  || 'date_mm58v7nv',
  // "Freight Carrier" (status) — human-readable carrier label for staff (display only,
  // NOT used as the AfterShip slug; kept for reference, e.g. shown on the Monday board)
  carrierLabel:   process.env.MONDAY_ACC_COL_CARRIER_LABEL || 'color_mm51tf2w',
  // "Carrier Code" (text) — the ACTUAL AfterShip slug (fedex / ups / usps /
  // fedex-freight / etc.), entered by staff. This is what gets sent to AfterShip.
  carrier:        process.env.MONDAY_ACC_COL_CARRIER       || 'text_mm58cnxf',
  // "Freight Tracking ID" (text)
  trackingNumber: process.env.MONDAY_ACC_COL_TRACKING      || 'text_mm5125q0',
  // "Carrier Status" (status) — written by AfterShip (via the accessory-webhook
  // push on entry, and the AfterShip webhook thereafter) as the shipment moves
  // through transit (In Transit / Out for Delivery / Delivered / Exception /
  // etc.); labels are auto-created on first write (create_labels_if_missing)
  carrierStatus:  process.env.MONDAY_ACC_COL_CARRIER_STATUS|| 'color_mm58zsbq',
};

// ── Referrals — standalone log board ──────────────────────────────────────────
// One item per "Refer a Friend" submission from the portal. Reward amount is
// computed by a Monday Formula column once staff fills in the referred
// order's value (2% of value, $25 floor, $500 cap) — not written by the app.
// Board ID must be set once the board is created (see MONDAY_REFERRAL_BOARD_ID).
export const REFERRAL_BOARD_ID = process.env.MONDAY_REFERRAL_BOARD_ID || '18422254966';

export const REFERRAL_COLS = {
  referrerName:      process.env.MONDAY_REF_COL_REFERRER_NAME   || 'text_mm59xen8',   // "Referrer Name"
  referrerEmail:     process.env.MONDAY_REF_COL_REFERRER_EMAIL  || 'text_mm59tasb',   // "Referrer Email"
  referrerOrderId:   process.env.MONDAY_REF_COL_REFERRER_ORDER  || 'text_mm597ngj',   // "Referrer Order Item ID"
  referrerOrderLink: process.env.MONDAY_REF_COL_REFERRER_LINK   || 'link_mm59wm1q',   // "Referrer Order Record Link"
  friendName:        process.env.MONDAY_REF_COL_FRIEND_NAME     || 'text_mm59ev00',   // "Referred Friend Name"
  friendEmail:       process.env.MONDAY_REF_COL_FRIEND_EMAIL    || 'text_mm59gert',   // "Referred Friend Email"
  friendPhone:       process.env.MONDAY_REF_COL_FRIEND_PHONE    || 'text_mm59v1f2',   // "Referred Friend Phone"
  message:           process.env.MONDAY_REF_COL_MESSAGE         || 'long_text_mm592qp0', // "Message" (long_text, optional)
  submittedDate:     process.env.MONDAY_REF_COL_SUBMITTED_DATE  || 'date_mm59a5gn',   // "Submitted Date"
  // Staff-managed after the fact — not written by createReferralItem():
  //   "Referred Order Value" (numeric_mm59x511), "Reward Amount" (formula_mm59bmwg,
  //   auto-computes 2% of order value, $25 floor / $500 cap), "Reward Type"
  //   (color_mm59j1g8: Account Credit / Gift Card), "Referral Status" (color_mm59a5h4:
  //   New Lead / Contacted / Converted / Not Interested / Reward Issued).
};

/**
 * Log a portal "Refer a Friend" submission as a new item on the standalone
 * Referrals board. Returns the new item's id, or throws if REFERRAL_BOARD_ID
 * isn't configured yet (board must be created in Monday first).
 */
export async function createReferralItem(order, fields) {
  if (!REFERRAL_BOARD_ID) {
    throw new Error('REFERRAL_BOARD_ID not configured — create the Referrals board in Monday first.');
  }
  const itemName = `${fields.friendName || 'Referral'} — referred by ${order.name || order.id}`;
  const itemId = await createBoardItem(REFERRAL_BOARD_ID, itemName);
  if (!itemId) throw new Error('Failed to create Referrals item.');

  const accountSlug = process.env.MONDAY_ACCOUNT_SLUG || 'summit-sensory-gym';
  const orderLink = accountSlug && process.env.MONDAY_BOARD_ID
    ? `https://${accountSlug}.monday.com/boards/${process.env.MONDAY_BOARD_ID}/pulses/${order.id}`
    : '';

  const writes = [
    [REFERRAL_COLS.referrerName, fields.referrerName || order.name || ''],
    [REFERRAL_COLS.referrerEmail, fields.referrerEmail || ''],
    [REFERRAL_COLS.referrerOrderId, String(order.id || '')],
    orderLink ? [REFERRAL_COLS.referrerOrderLink, { url: orderLink, text: order.name || String(order.id) }] : null,
    [REFERRAL_COLS.friendName, fields.friendName || ''],
    [REFERRAL_COLS.friendEmail, fields.friendEmail || ''],
    [REFERRAL_COLS.friendPhone, fields.friendPhone || ''],
    [REFERRAL_COLS.message, fields.message || ''],
    [REFERRAL_COLS.submittedDate, { date: new Date().toISOString().split('T')[0] }],
  ].filter(entry => Boolean(entry) && Boolean(entry[0]));

  for (const [colId, value] of writes) {
    await updateItemColumnOnBoard(REFERRAL_BOARD_ID, itemId, colId, value)
      .catch(err => console.error(`Referral column write failed (${colId}):`, err.message));
  }
  return itemId;
}

const ACCESSORY_NOT_SHIPPED_LABEL = 'not shipped';

/** Normalize the Carrier Code field into an AfterShip slug (plain text, staff-entered). */
export function accessoryCarrierLabelToSlug(label) {
  const v = (label || '').trim();
  if (!v || v.toLowerCase() === ACCESSORY_NOT_SHIPPED_LABEL) return '';
  return v;
}

// ── Status label → portal stage mapping ──────────────────────────────────────
export const STATUS_STAGES = [
  { key: 'order_placed',     label: process.env.MONDAY_STATUS_ORDER_PLACED      || 'Order Placed',     icon: '📋' },
  { key: 'in_manufacturing', label: process.env.MONDAY_STATUS_IN_MANUFACTURING  || 'In Manufacturing', icon: '🔧' },
  { key: 'ready_to_ship',    label: process.env.MONDAY_STATUS_READY_TO_SHIP     || 'Ready to Ship',    icon: '📦' },
  { key: 'shipped',          label: process.env.MONDAY_STATUS_SHIPPED           || 'Shipped',          icon: '🚚' },
  { key: 'delivered',        label: process.env.MONDAY_STATUS_DELIVERED         || 'Delivered',        icon: '✅' },
];

// ── Core query helper ─────────────────────────────────────────────────────────
async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
      'API-Version': '2024-04',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Monday.com API error: ${res.status} ${res.statusText} — ${body}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Monday.com GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

// ── Board helpers ─────────────────────────────────────────────────────────────

/** List all accessible boards (for admin settings) */
export async function listBoards() {
  const data = await mondayQuery(`
    query {
      boards(limit: 50, order_by: created_at) {
        id name description
      }
    }
  `);
  return data.boards;
}

/** Get all column definitions for a board */
export async function getBoardColumns(boardId = process.env.MONDAY_BOARD_ID) {
  const data = await mondayQuery(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) {
        columns { id title type }
      }
    }
  `, { boardId: [boardId] });
  return data.boards[0]?.columns || [];
}

// ── Order helpers ─────────────────────────────────────────────────────────────

/** Fetch ALL orders for a customer email — supports repeat customers */
export async function getOrdersByEmail(email) {
  // Fetch all orders and filter by email in-memory.
  // More reliable than Monday.com column-filter queries across API versions.
  const all = await getAllOrders(500);
  const normalized = email.toLowerCase().trim();
  return all.filter(o => o.customerEmail?.toLowerCase().trim() === normalized);
}

/** Fetch a single order by customer email (returns most recent match) */
export async function getOrderByEmail(email) {
  const orders = await getOrdersByEmail(email);
  return orders[0] || null;
}

/** Fetch all orders (for admin view) */
export async function getAllOrders(limit = 100) {
  const data = await mondayQuery(`
    query($boardId: [ID!], $limit: Int!) {
      boards(ids: $boardId) {
        items_page(limit: $limit) {
          items {
            id name created_at
            column_values { id text value }
            subitems {
              id name
              column_values { id text value }
            }
          }
        }
      }
    }
  `, {
    boardId: [process.env.MONDAY_BOARD_ID],
    limit,
  });

  const items = data.boards?.[0]?.items_page?.items || [];
  return Promise.all(items.map(parseOrderItem));
}

/** Fetch a single order by item ID */
export async function getOrderById(itemId) {
  const data = await mondayQuery(`
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        id name created_at
        column_values { id text value }
        assets {
          id name public_url file_extension file_size created_at
        }
        subitems {
          id name
          column_values { id text value }
        }
      }
    }
  `, { itemId: [itemId] });

  const item = data.items?.[0];
  if (!item) return null;
  return parseOrderItem(item);
}

/** Update a column value on any board (used internally by updateOrderColumn and cross-board writes) */
export async function updateItemColumnOnBoard(boardId, itemId, columnId, value) {
  const data = await mondayQuery(`
    mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
      ) {
        id
      }
    }
  `, {
    boardId,
    itemId,
    columnId,
    value: JSON.stringify(value),
  });
  return data.change_column_value;
}

/** Update a column value on an order (Manufacturing Process board) */
export async function updateOrderColumn(itemId, columnId, value) {
  return updateItemColumnOnBoard(process.env.MONDAY_BOARD_ID, itemId, columnId, value);
}

/** Create a new item on any board, returning its id */
export async function createBoardItem(boardId, itemName) {
  const data = await mondayQuery(`
    mutation($boardId: ID!, $itemName: String!) {
      create_item(board_id: $boardId, item_name: $itemName) { id }
    }
  `, { boardId, itemName });
  return data.create_item?.id;
}

/**
 * Log a customer portal "Delivery & Site Details" submission as a new row on
 * the standalone Delivery & Site Details Submissions board (DELIVERY_BOARD_ID).
 * Unlike updateOrderColumn (which edits the single Manufacturing Process row
 * for an order), this creates a NEW item every time — preserving a full
 * history if a customer edits and resubmits. Returns the new item's id.
 */
export async function createDeliverySubmissionItem(order, fields) {
  const itemName = `${order.name || order.id} — ${new Date().toLocaleDateString()}`;
  const itemId = await createBoardItem(DELIVERY_BOARD_ID, itemName);
  if (!itemId) throw new Error('Failed to create Delivery & Site Details Submissions item.');

  const accountSlug = process.env.MONDAY_ACCOUNT_SLUG || 'summit-sensory-gym';
  const orderLink = accountSlug && process.env.MONDAY_BOARD_ID
    ? `https://${accountSlug}.monday.com/boards/${process.env.MONDAY_BOARD_ID}/pulses/${order.id}`
    : '';

  const writes = [
    [DELIVERY_COLS.orderItemId, String(order.id || '')],
    orderLink ? [DELIVERY_COLS.orderRecordLink, { url: orderLink, text: order.name || String(order.id) }] : null,
    [DELIVERY_COLS.customerEmail, fields.customerEmail || ''],
    [DELIVERY_COLS.submittedDate, { date: new Date().toISOString().split('T')[0] }],
    [DELIVERY_COLS.primaryPocName, fields.pocName || ''],
    [DELIVERY_COLS.primaryPocPhone, fields.pocPhone || ''],
    [DELIVERY_COLS.primaryPocCanText, { checked: fields.phoneCanText ? 'true' : 'false' }],
    [DELIVERY_COLS.primaryPocEmail, fields.pocEmail || ''],
    [DELIVERY_COLS.specialInstructions, fields.specialInstructions || ''],
    [DELIVERY_COLS.hasSecondaryPoc, fields.hasSecondaryPoc ? 'Yes' : 'No'],
    [DELIVERY_COLS.secondaryPocName, fields.secondaryPocName || ''],
    [DELIVERY_COLS.secondaryPocPhone, fields.secondaryPocPhone || ''],
    [DELIVERY_COLS.secondaryPocCanText, { checked: fields.secondaryPhoneCanText ? 'true' : 'false' }],
    [DELIVERY_COLS.secondaryPocEmail, fields.secondaryPocEmail || ''],
    [DELIVERY_COLS.primaryCommMethods, Array.isArray(fields.primaryCommMethods) ? fields.primaryCommMethods.join(', ') : (fields.primaryCommMethods || '')],
    [DELIVERY_COLS.primaryMobileForText, fields.primaryMobilePhone || ''],
    [DELIVERY_COLS.secondaryCommMethods, Array.isArray(fields.secondaryCommMethods) ? fields.secondaryCommMethods.join(', ') : (fields.secondaryCommMethods || '')],
    [DELIVERY_COLS.secondaryMobileForText, fields.secondaryMobilePhone || ''],
    [DELIVERY_COLS.loadingDock, fields.loadingDock || ''],
    [DELIVERY_COLS.deliveryTiming, fields.deliveryTiming || ''],
    fields.preferredDeliveryDate ? [DELIVERY_COLS.preferredDeliveryDate, { date: fields.preferredDeliveryDate }] : null,
    [DELIVERY_COLS.addressConfirmed, fields.addressConfirmed === true ? 'Yes' : fields.addressConfirmed === false ? 'No' : ''],
    [DELIVERY_COLS.addressLine1, fields.addressLine1 || ''],
    [DELIVERY_COLS.addressLine2, fields.addressLine2 || ''],
    [DELIVERY_COLS.city, fields.addressCity || ''],
    [DELIVERY_COLS.stateProvince, fields.addressState || ''],
    [DELIVERY_COLS.postalCode, fields.addressZip || ''],
    [DELIVERY_COLS.country, fields.addressCountry || ''],
    [DELIVERY_COLS.formattedAddress, fields.formattedAddress || ''],
    [DELIVERY_COLS.freightAckBy, fields.freightAckBy || ''],
    fields.freightAckDate ? [DELIVERY_COLS.freightAckDate, { date: fields.freightAckDate }] : null,
    [DELIVERY_COLS.restrictedChanges, Array.isArray(fields.changedRestricted) ? fields.changedRestricted.join(', ') : (fields.changedRestricted || '')],
  ].filter(Boolean);

  for (const [colId, value] of writes) {
    await updateItemColumnOnBoard(DELIVERY_BOARD_ID, itemId, colId, value)
      .catch(err => console.error(`Delivery submission column write failed (${colId}):`, err));
  }
  return itemId;
}

/** Update order status */
export async function updateOrderStatus(itemId, statusLabel) {
  return updateOrderColumn(itemId, COLS.status, { label: statusLabel });
}

/**
 * Mark a portal onboarding section complete by flipping its Status column to ✅.
 * `colKey` is one of the portal* keys in COLS (e.g. 'portalContact').
 * No-op if that column isn't configured. Uses create_labels_if_missing so the
 * write can't hard-fail on first use, but the label should already match the
 * "complete" label configured on the Monday board.
 */
export async function markSectionComplete(itemId, colKey) {
  const columnId = COLS[colKey];
  if (!columnId) {
    console.warn(`markSectionComplete: no column configured for "${colKey}" — skipping`);
    return null;
  }
  const data = await mondayQuery(`
    mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
        create_labels_if_missing: true
      ) {
        id
      }
    }
  `, {
    boardId: process.env.MONDAY_BOARD_ID,
    itemId,
    columnId,
    value: PORTAL_DONE_LABEL,
  });
  return data.change_simple_column_value;
}

/**
 * Write a live carrier status onto an accessory subitem's "Carrier Status"
 * column. Uses change_simple_column_value with create_labels_if_missing so
 * AfterShip's status vocabulary (In Transit, Out for Delivery, Delivered,
 * Exception, etc.) doesn't need to be pre-configured as Monday labels first —
 * each new label is created automatically on first use, same pattern as
 * markSectionComplete's ✅ label above.
 */
export async function updateAccessoryCarrierStatus(subitemId, statusLabel) {
  const data = await mondayQuery(`
    mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
        create_labels_if_missing: true
      ) {
        id
      }
    }
  `, {
    boardId: ACCESSORY_BOARD_ID,
    itemId: subitemId,
    columnId: ACCESSORY_COLS.carrierStatus,
    value: statusLabel,
  });
  return data.change_simple_column_value;
}

/**
 * Find the accessory subitem matching a carrier slug + tracking number, by
 * scanning all items on the Therapy Equipment & Accessories board. Used by
 * the AfterShip webhook, which only knows slug + tracking number, not which
 * subitem/order they belong to. Board size is small (misc items only), so an
 * in-memory scan is simpler and more reliable than a column-value filter
 * query across Monday API versions.
 */
export async function findAccessorySubitemByTracking(slug, trackingNumber) {
  const data = await mondayQuery(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          items {
            id name
            column_values { id text value }
          }
        }
      }
    }
  `, { boardId: [ACCESSORY_BOARD_ID] });

  const items = data.boards?.[0]?.items_page?.items || [];
  const wantedSlug = (slug || '').trim().toLowerCase();
  const wantedNumber = (trackingNumber || '').trim();

  for (const item of items) {
    const cmap = {};
    for (const col of item.column_values || []) cmap[col.id] = { text: col.text, value: col.value };
    const itemNumber = cmap[ACCESSORY_COLS.trackingNumber]?.text?.trim() || '';
    const itemSlug = accessoryCarrierLabelToSlug(cmap[ACCESSORY_COLS.carrier]?.text || '').toLowerCase();
    if (itemNumber === wantedNumber && (!wantedSlug || itemSlug === wantedSlug)) {
      return { id: item.id, name: item.name };
    }
  }
  return null;
}

/**
 * Fetch one accessory subitem's current column values by id. Used by the
 * Monday → AfterShip push webhook: a Monday column-change event only reliably
 * tells us WHICH column just changed, not the other column's current value,
 * so we re-fetch the whole subitem before deciding whether we now have both
 * a carrier slug and a tracking number.
 */
export async function getAccessorySubitemById(subitemId) {
  const data = await mondayQuery(`
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        id name
        column_values { id text value }
      }
    }
  `, { itemId: [subitemId] });

  const item = data.items?.[0];
  if (!item) return null;
  return parseAccessorySubitem(item);
}

/**
 * Fetch every item on the Therapy Equipment & Accessories board, parsed.
 * Used by the accessory-tracking-sync cron job (EP-23), which proactively
 * onboards any item with both a carrier + tracking number into AfterShip on
 * a schedule — Monday doesn't support subitem-level webhooks (confirmed via
 * the Monday API: "Creating webhook on subitems board isn't allowed", and
 * `change_subitem_column_value` on the parent board errored server-side), so
 * this polling job is the reliable mechanism instead of a live push.
 */
export async function getAllAccessoryItems() {
  const data = await mondayQuery(`
    query($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          items {
            id name
            column_values { id text value }
          }
        }
      }
    }
  `, { boardId: [ACCESSORY_BOARD_ID] });

  const items = data.boards?.[0]?.items_page?.items || [];
  return items.map(parseAccessorySubitem);
}

/** Update invoice link (stored as plain text URL) */
export async function updateInvoiceLink(itemId, url) {
  return updateOrderColumn(itemId, COLS.invoiceLink, url);
}

/** Post a tagged internal update (used to store billing info, freight ack, etc.) */
export async function postTaggedUpdate(itemId, tag, content) {
  const body = `[${tag}]\n${content}`;
  return postOrderMessage(itemId, body);
}

// ── File helpers ──────────────────────────────────────────────────────────────

/** Get files attached to an order's Portal Files column */
export async function getOrderFiles(itemId) {
  const data = await mondayQuery(`
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        assets {
          id name public_url file_extension file_size created_at
          uploaded_by { id name }
        }
      }
    }
  `, { itemId: [itemId] });

  return data.items?.[0]?.assets || [];
}

/** Add a file to a Monday.com item via URL */
export async function addFileToOrder(itemId, fileUrl, fileName) {
  const data = await mondayQuery(`
    mutation($itemId: ID!, $columnId: String!, $file: String!) {
      add_file_to_column(
        item_id: $itemId
        column_id: $columnId
        file: $file
      ) {
        id name public_url
      }
    }
  `, {
    itemId,
    columnId: COLS.portalFiles,
    file: fileUrl,
  });
  return data.add_file_to_column;
}

// ── User-Generated Content (Photo/Video Showcase) — reward-tracked submissions ─
// Photos/videos submitted via the "Share Your Gym" Jotform are attached
// directly to the order's own Photos/Videos file columns on the Manufacturing
// Process board (like Portal Files, not a separate board) plus running
// Number-column counts so staff see progress toward the reward at a glance.
export const UGC_COLS = {
  photos:        process.env.MONDAY_COL_UGC_PHOTOS        || 'file_mm59ndjx',    // Files column — "Customer Photos"
  videos:        process.env.MONDAY_COL_UGC_VIDEOS        || 'file_mm599cvb',    // Files column — "Customer Videos"
  photoCount:    process.env.MONDAY_COL_UGC_PHOTO_COUNT    || 'numeric_mm59hr',   // Number column — running photo count
  videoCount:    process.env.MONDAY_COL_UGC_VIDEO_COUNT    || 'numeric_mm593cqk', // Number column — running video count
  rewardCredits: process.env.MONDAY_COL_UGC_CREDITS        || 'numeric_mm59p094', // Number column — photos + videos*2
  rewardStatus:  process.env.MONDAY_COL_UGC_REWARD_STATUS  || 'color_mm59p3gr',   // Status column — None / Pending Review / Approved / Paid
};

// Credits needed per $25 reward tier: 1 photo = 1 credit, 1 video = 2 credits.
const UGC_CREDITS_PER_TIER = 10;

/** Attach one submitted photo or video URL to the order's UGC file columns. */
export async function attachUgcFile(itemId, fileUrl, type) {
  const colId = type === 'video' ? UGC_COLS.videos : UGC_COLS.photos;
  if (!colId) {
    console.warn(`attachUgcFile: UGC ${type} column not configured — skipping`);
    return null;
  }
  const data = await mondayQuery(`
    mutation($itemId: ID!, $columnId: String!, $file: String!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) {
        id name public_url
      }
    }
  `, { itemId, columnId: colId, file: fileUrl });
  return data.add_file_to_column;
}

/**
 * Increment the order's running photo/video counts, recompute reward credits
 * (photos + videos*2), and flip "Reward Status" to "Pending Review" whenever
 * the customer crosses a new multiple of UGC_CREDITS_PER_TIER since the last
 * count. Staff does a quick quality check (angles, usage, video length) and
 * approves the reward manually — this only automates the counting/threshold
 * detection, not the approval itself.
 */
export async function incrementUgcCounts(itemId, photoDelta = 0, videoDelta = 0) {
  if (!UGC_COLS.photoCount || !UGC_COLS.videoCount) {
    console.warn('incrementUgcCounts: UGC count columns not configured — skipping');
    return null;
  }

  const colIds = [UGC_COLS.photoCount, UGC_COLS.videoCount, UGC_COLS.rewardStatus].filter(Boolean);
  const data = await mondayQuery(`
    query($itemId: [ID!], $colIds: [String!]) {
      items(ids: $itemId) {
        column_values(ids: $colIds) { id text value }
      }
    }
  `, { itemId: [itemId], colIds });

  const colMap = {};
  for (const cv of data.items?.[0]?.column_values || []) colMap[cv.id] = cv;

  const prevPhotoCount = Number(colMap[UGC_COLS.photoCount]?.text) || 0;
  const prevVideoCount = Number(colMap[UGC_COLS.videoCount]?.text) || 0;
  const prevCredits = prevPhotoCount + prevVideoCount * 2;
  const prevTier = Math.floor(prevCredits / UGC_CREDITS_PER_TIER);

  const photoCount = prevPhotoCount + photoDelta;
  const videoCount = prevVideoCount + videoDelta;
  const credits = photoCount + videoCount * 2;
  const newTier = Math.floor(credits / UGC_CREDITS_PER_TIER);
  const crossedNewTier = newTier > prevTier;

  await updateOrderColumn(itemId, UGC_COLS.photoCount, photoCount)
    .catch(err => console.error('UGC photoCount write failed:', err.message));
  await updateOrderColumn(itemId, UGC_COLS.videoCount, videoCount)
    .catch(err => console.error('UGC videoCount write failed:', err.message));
  if (UGC_COLS.rewardCredits) {
    await updateOrderColumn(itemId, UGC_COLS.rewardCredits, credits)
      .catch(err => console.error('UGC credits write failed:', err.message));
  }
  if (crossedNewTier && UGC_COLS.rewardStatus) {
    await updateOrderColumn(itemId, UGC_COLS.rewardStatus, { label: 'Pending Review' })
      .catch(err => console.error('UGC rewardStatus write failed:', err.message));
  }

  return { photoCount, videoCount, credits, crossedNewTier, newTier };
}

// ── Message helpers ───────────────────────────────────────────────────────────

/** Get updates (messages) on an order */
export async function getOrderMessages(itemId) {
  const data = await mondayQuery(`
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        updates(limit: 50) {
          id body created_at
          creator { id name email }
          replies {
            id body created_at
            creator { id name email }
          }
        }
      }
    }
  `, { itemId: [itemId] });

  return data.items?.[0]?.updates || [];
}

/** Post a message (update) on an order */
export async function postOrderMessage(itemId, body) {
  const data = await mondayQuery(`
    mutation($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id body created_at
        creator { id name email }
      }
    }
  `, { itemId, body });
  return data.create_update;
}

/** Reply to an existing message */
export async function replyToMessage(updateId, body) {
  const data = await mondayQuery(`
    mutation($updateId: ID!, $body: String!) {
      create_update(parent_update_id: $updateId, body: $body) {
        id body created_at
        creator { id name email }
      }
    }
  `, { updateId, body });
  return data.create_update;
}

/** Update tracking number (writes to a dedicated writable text column) */
export async function updateTrackingNumber(itemId, trackingNumber) {
  const colId = process.env.MONDAY_COL_TRACKING_WRITE;
  if (!colId) {
    console.warn('updateTrackingNumber: MONDAY_COL_TRACKING_WRITE not set — skipping column write');
    return null;
  }
  return updateOrderColumn(itemId, colId, trackingNumber);
}

/** Update balance due (writes to a dedicated number/currency column) */
export async function updateBalance(itemId, balance) {
  const colId = process.env.MONDAY_COL_BALANCE;
  if (!colId) {
    console.warn('updateBalance: MONDAY_COL_BALANCE not set — skipping column write');
    return null;
  }
  return updateOrderColumn(itemId, colId, balance);
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

/**
 * Monday.com rewrites hyperlinks typed into Long Text columns through its own
 * click-tracking redirector (trackingservice.monday.com/tracker/link?...) —
 * the original YouTube/Vimeo/etc URL is opaque to us until that redirect is
 * followed. Resolve it server-side so the portal always embeds the real
 * video instead of falling back to an external "View Video" link.
 */
async function resolveTrackedUrl(url) {
  if (!url || !url.includes('trackingservice.monday.com')) return url;
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (head.url && head.url !== url) return head.url;
  } catch {}
  try {
    const controller = new AbortController();
    const get = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    controller.abort(); // don't bother downloading the destination page body
    if (get.url && get.url !== url) return get.url;
  } catch {}
  return url;
}

async function resolveTrackedUrlList(csv) {
  if (!csv) return '';
  const urls = csv.split(',').map(u => u.trim()).filter(Boolean);
  const resolved = await Promise.all(urls.map(resolveTrackedUrl));
  return resolved.join(',');
}

/** Normalize a Monday.com item into a clean order object */
async function parseOrderItem(item) {
  const colMap = {};
  for (const col of item.column_values || []) {
    colMap[col.id] = { text: col.text, value: col.value };
  }

  const get = (colKey) => colMap[COLS[colKey]]?.text || '';

  /**
   * Read a URL from a column that may be a plain Text column *or* a Monday
   * "Link" column.  Monday Link columns store the URL inside the value JSON
   * blob (`{url, text}`) while `col.text` holds only the display label.
   * Also handles long-text columns where `col.value` wraps the text in JSON.
   */
  const getUrl = (colKey) => {
    const col = colMap[COLS[colKey]];
    if (!col) return null;
    const text = col.text?.trim() || '';
    // Plain-text column: the text IS the URL
    if (text.startsWith('http')) return text;
    // Link column or any column where the URL lives in the value JSON blob
    try {
      const parsed = JSON.parse(col.value || 'null');
      if (!parsed) return text || null;
      // Monday Link column: { url: "...", text: "label" }
      if (parsed.url) return String(parsed.url).trim();
      // Occasionally stored as a bare JSON string
      if (typeof parsed === 'string' && parsed.startsWith('http')) return parsed.trim();
    } catch {}
    return text || null;
  };

  /**
   * Read plain text from Text / Long Text columns, with a JSON fallback for
   * long_text columns where Monday sometimes wraps the value in { text: "..." }.
   */
  const getText = (colKey) => {
    const col = colMap[COLS[colKey]];
    if (!col) return '';
    if (col.text?.trim()) return col.text.trim();
    try {
      const parsed = JSON.parse(col.value || 'null');
      if (!parsed) return '';
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed.text?.trim()) return parsed.text.trim();
    } catch {}
    return '';
  };

  /**
   * Mirror/lookup columns (prefix: lookup_) often return an empty `text` field
   * even when a value exists. The actual mirrored value is nested inside the
   * `value` JSON in several possible formats depending on Monday.com API version.
   */
  const getMirror = (colKey) => {
    const col = colMap[COLS[colKey]];
    if (!col) return '';
    // text field works for most column types including mirrors in standard queries
    if (col.text?.trim()) return col.text.trim();
    // Parse the raw JSON value blob as fallback
    try {
      const parsed = JSON.parse(col.value || 'null');
      if (!parsed) return '';
      if (Array.isArray(parsed.displayValues) && parsed.displayValues[0]) {
        return String(parsed.displayValues[0]).trim();
      }
      if (Array.isArray(parsed.values)) {
        for (const v of parsed.values) {
          if (v?.text?.trim()) return v.text.trim();
          if (Array.isArray(v?.columns)) {
            for (const c of v.columns) {
              if (c?.text?.trim()) return c.text.trim();
            }
          }
        }
      }
    } catch {}
    return '';
  };
  const getStage = () => {
    const statusText = get('status');
    const match = STATUS_STAGES.findIndex(s => s.label === statusText);
    return match >= 0 ? match : 0;
  };

  return {
    id: item.id,
    name: item.name,
    createdAt: item.created_at,
    status: get('status'),
    stageIndex: getStage(),
    stages: STATUS_STAGES,
    customerEmail: get('customerEmail'),
    // URL fields — use getUrl() to handle both plain-text and Monday Link columns
    invoiceLink: getUrl('invoiceLink') || null,
    paymentLink: getUrl('paymentLink') || null,
    shipDate: get('shipDate'),
    // Long-text columns — use getText() to handle JSON-wrapped values
    address: getText('address'),
    productType: get('productType'),
    // Mirror columns — use getMirror() to handle Monday.com's JSON value format
    phone: getMirror('phone'),
    pocName: getMirror('pocName'),
    pocEmail: getMirror('pocEmail'),
    firstName: getMirror('firstName'),
    deliveryInstructions: getMirror('deliveryInstructions'),
    trackingNumber: getMirror('trackingNumber') || getMirror('freightTracking'),
    // Contact Information tab — Primary Contact
    contactName: getMirror('contactName'),
    contactEmail: getMirror('contactEmail'),
    contactPhone: getMirror('contactPhone'),
    // Billing Information tab — Bill-To Address. Prefers the customer-confirmed address
    // (written instantly on Billing tab submit, no staff review) over the read-only
    // mirror from the Manufacturing Process board. The confirmed value is already a
    // fully formatted single string (includes zip), so billingZipOnFile is left blank
    // in that case to avoid double-appending the zip wherever these are concatenated.
    billingAddressConfirmed: getText('billingAddressConfirmed'),
    billingAddressOnFile: getText('billingAddressConfirmed') || getMirror('billingAddressOnFile'),
    billingZipOnFile: getText('billingAddressConfirmed') ? '' : getMirror('billingZipOnFile'),
    // Color form: try sources in order of reliability.
    colorFormId: (() => {
      // 1. Direct writable text column — most reliable, no JSON parsing needed
      const direct = getUrl('colorFormDirect');
      if (direct) {
        const m = direct.match(/(\d{10,})/);
        return m ? m[1] : direct;
      }

      // 2. Env var hard-override
      const envId = (process.env.JOTFORM_COLOR_FORM_ID || '').trim();
      if (envId) return envId;

      // Exhaustive extraction from the raw mirror column value
      const col = colMap[COLS.colorFormId];
      if (!col) return '';

      // 1. col.text — works when Monday populates it
      const textVal = col.text?.trim() || '';

      // 2. Parse col.value JSON — try every known Monday mirror/lookup format
      let jsonVal = '';
      try {
        const parsed = JSON.parse(col.value || 'null');
        if (parsed) {
          // { displayValues: ["https://..."] }
          if (Array.isArray(parsed.displayValues)) {
            for (const dv of parsed.displayValues) {
              const s = String(dv || '').trim();
              if (s) { jsonVal = s; break; }
            }
          }
          // { values: [{ text, url, columns[] }] }
          if (!jsonVal && Array.isArray(parsed.values)) {
            outer: for (const v of parsed.values) {
              if (v?.url) { jsonVal = String(v.url).trim(); break; }
              if (v?.text?.trim()) { jsonVal = v.text.trim(); break; }
              if (Array.isArray(v?.columns)) {
                for (const c of v.columns) {
                  if (c?.url) { jsonVal = String(c.url).trim(); break outer; }
                  if (c?.text?.trim()) { jsonVal = c.text.trim(); break outer; }
                }
              }
            }
          }
          // { url: "..." } top-level
          if (!jsonVal && parsed.url) jsonVal = String(parsed.url).trim();
          // bare string value
          if (!jsonVal && typeof parsed === 'string') jsonVal = parsed.trim();
        }
      } catch {}

      const raw = textVal || jsonVal;
      if (!raw) return '';
      // Extract numeric Jotform ID from a full URL, or return as-is
      const match = raw.match(/(\d{10,})/);
      return match ? match[1] : raw;
    })(),
    // Photo/Video Showcase form — direct writable text column, or env override
    showcaseFormId: (() => {
      const direct = getUrl('showcaseFormDirect');
      if (direct) {
        const m = direct.match(/(\d{10,})/);
        return m ? m[1] : direct;
      }
      return (process.env.JOTFORM_SHOWCASE_FORM_ID || '').trim();
    })(),
    // Multi-shipment tracking (populated via env-configured Monday columns)
    matTracking: getText('matTracking') || '',
    otherShipments: getText('otherShipments') || '',
    // AfterShip tracking inputs (slug + tracking number per shipment)
    frameCarrierSlug: getText('frameCarrierSlug') || '',
    frameTrackingId:  getText('frameTrackingId') || '',
    matsCarrierSlug:  getText('matsCarrierSlug') || '',
    matsTrackingId:   getText('matsTrackingId') || '',
    // Installation content — getText() handles long_text JSON wrapping.
    // Video URLs are additionally unwrapped from Monday's tracking redirector.
    installationVideos: await resolveTrackedUrlList(getText('installationVideos')),
    installationDocs: getText('installationDocs') || '',
    installationLinks: getText('installationLinks') || '',
    // Therapy Equipment & Accessories — one entry per Monday subitem (replaces
    // the old single-column DS-12/otherShipments text hack)
    accessoryItems: (item.subitems || []).map(parseAccessorySubitem),
    files: item.assets || [],
    // All raw column values keyed by column ID — used by dynamic column picker
    rawColumns: colMap,
  };
}

/**
 * Normalize one Monday subitem from the Therapy Equipment & Accessories board
 * into the shape the portal's StatusTab renders.
 *   orderStatus:   'Order Pending' | 'Ordered' | 'Out of Stock'
 *   carrierSlug:   AfterShip slug once a carrier is set, else ''
 *   trackingNumber: tracking number once entered, else ''
 *   carrierStatus: live status label written by the AfterShip webhook, else ''
 */
function parseAccessorySubitem(subitem) {
  const cmap = {};
  for (const col of subitem.column_values || []) {
    cmap[col.id] = { text: col.text, value: col.value };
  }
  const text = (colId) => cmap[colId]?.text?.trim() || '';

  return {
    id: subitem.id,
    name: subitem.name || 'Item',
    orderStatus: text(ACCESSORY_COLS.orderStatus) || 'Order Pending',
    dateOrdered: text(ACCESSORY_COLS.dateOrdered),
    carrierSlug: accessoryCarrierLabelToSlug(text(ACCESSORY_COLS.carrier)),
    trackingNumber: text(ACCESSORY_COLS.trackingNumber),
    carrierStatus: text(ACCESSORY_COLS.carrierStatus),
  };
}
