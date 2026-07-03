/**
 * Monday.com GraphQL client and helpers.
 * All column IDs are read from environment variables so they can be
 * reconfigured from the Admin Settings without touching code.
 */

const MONDAY_API = 'https://api.monday.com/v2';

// ── Column ID map — confirmed against Manufacturing Process board (ID: 6533700776)
export const COLS = {
  customerEmail:  process.env.MONDAY_COL_CUSTOMER_EMAIL  || 'email__1',           // "Email Address" (email)
  status:         process.env.MONDAY_COL_STATUS           || 'status__1',          // "Manufacturing Phase" (status)
  trackingNumber: process.env.MONDAY_COL_TRACKING_NUMBER  || 'lookup_mm1kcbb5',   // "GB FedEx Tracking Number" (mirror, read-only)
  freightTracking:process.env.MONDAY_COL_FREIGHT_TRACKING || 'dup__of_gb_production7__1', // "Freight Tracking ID" (mirror, read-only)
  portalFiles:    process.env.MONDAY_COL_PORTAL_FILES     || 'file_mm4wbdrh',     // "Portal Files" (file)
  invoiceLink:    process.env.MONDAY_COL_INVOICE_LINK     || 'text_mm4wfamc',     // "Link to Customer Invoice" (text/URL)
  shipDate:       process.env.MONDAY_COL_SHIP_DATE        || 'date_mkvvpex1',     // "Initial Projected Ship Date" (date)
  address:        process.env.MONDAY_COL_ADDRESS          || 'long_text_mkpkdtj4',// "Confirmed Delivery Address" (long_text)
  productType:    process.env.MONDAY_COL_PRODUCT_TYPE     || 'color_mkvw7b8',     // "Product Series STD Column" (status)
  // Mirror columns (read-only — sourced from connected boards)
  phone:          'lookup_mkwaee43',    // "POC Phone"
  pocName:        'lookup_mkwb5bty',   // "Delivery POC Name"
  pocEmail:       'lookup_mkwazctw',   // "POC Email"
  firstName:      'lookup_mkvx85hs',   // "First Name"
  deliveryInstructions: 'lookup_mm0anh5a', // "Special Delivery Instructions"
};

// ── Status label → portal stage mapping ──────────────────────────────────────
export const STATUS_STAGES = [
  { key: 'order_placed',      label: process.env.MONDAY_STATUS_ORDER_PLACED       || 'Order Placed',       icon: '📋' },
  { key: 'deposit_received',  label: process.env.MONDAY_STATUS_DEPOSIT_RECEIVED   || 'Deposit Received',   icon: '💰' },
  { key: 'in_manufacturing',  label: process.env.MONDAY_STATUS_IN_MANUFACTURING   || 'In Manufacturing',   icon: '🔧' },
  { key: 'ready_to_ship',     label: process.env.MONDAY_STATUS_READY_TO_SHIP      || 'Ready to Ship',      icon: '📦' },
  { key: 'shipped',           label: process.env.MONDAY_STATUS_SHIPPED            || 'Shipped',            icon: '🚚' },
  { key: 'delivered',         label: process.env.MONDAY_STATUS_DELIVERED          || 'Delivered',          icon: '✅' },
];

// ── Core query helper ─────────────────────────────────────────────────────────
async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_TOKEN,
      'API-Version': '2024-01',
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
          }
        }
      }
    }
  `, {
    boardId: [process.env.MONDAY_BOARD_ID],
    limit,
  });

  const items = data.boards?.[0]?.items_page?.items || [];
  return items.map(parseOrderItem);
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
      }
    }
  `, { itemId: [itemId] });

  const item = data.items?.[0];
  if (!item) return null;
  return parseOrderItem(item);
}

/** Update a column value on an order */
export async function updateOrderColumn(itemId, columnId, value) {
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
    boardId: process.env.MONDAY_BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(value),
  });
  return data.change_column_value;
}

/** Update order status */
export async function updateOrderStatus(itemId, statusLabel) {
  return updateOrderColumn(itemId, COLS.status, { label: statusLabel });
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
      create_update(parent_item_id: $updateId, body: $body) {
        id body created_at
        creator { id name email }
      }
    }
  `, { updateId, body });
  return data.create_update;
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

/** Normalize a Monday.com item into a clean order object */
function parseOrderItem(item) {
  const colMap = {};
  for (const col of item.column_values || []) {
    colMap[col.id] = { text: col.text, value: col.value };
  }

  const get = (colKey) => colMap[COLS[colKey]]?.text || '';
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
    trackingNumber: get('trackingNumber') || get('freightTracking'),
    invoiceLink: get('invoiceLink') || null,
    shipDate: get('shipDate'),
    address: get('address'),
    productType: get('productType'),
    phone: get('phone'),
    pocName: get('pocName'),
    pocEmail: get('pocEmail'),
    firstName: get('firstName'),
    deliveryInstructions: get('deliveryInstructions'),
    files: item.assets || [],
    // All raw column values keyed by column ID — used by dynamic column picker
    rawColumns: colMap,
  };
}
