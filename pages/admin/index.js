/**
 * Admin Portal — staff-only, protected by M365 SSO.
 * Sections: Dashboard, Orders, Customers, Files, Messages, Settings
 */

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { sanitizeMessageHtml } from '../../lib/sanitizeHtml';
import { isStaffMessage, stripPortalTags, messageDisplayName } from '../../lib/messageOrigin';
import { requiredColorInputs, PART_LABELS } from '../../lib/colorRequirements';
import { resolveSelectedColor, displayColorName, findOrphanedSelections } from '../../lib/colorCatalog';

// Lazy-loaded — most staff sessions never open Settings in a given visit,
// so its code (see components/admin/SettingsTab.js) shouldn't be part of
// the initial admin bundle. A small inline loading state avoids a layout
// jump while the chunk fetches.
const SettingsTab = dynamic(() => import('../../components/admin/SettingsTab'), {
  loading: () => <div className="card"><div className="spin" style={{ width: 24, height: 24 }} /></div>,
});

const TABS = [
  { id: 'dashboard',  icon: '📊', label: 'Dashboard' },
  { id: 'orders',     icon: '📦', label: 'Orders' },
  { id: 'customers',  icon: '👥', label: 'Customers' },
  { id: 'files',      icon: '📁', label: 'File Manager' },
  { id: 'messages',   icon: '💬', label: 'Messages' },
  { id: 'settings',   icon: '⚙️', label: 'Settings' },
];

export default function AdminPortal() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/monday/orders');
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') loadOrders();
  }, [status, loadOrders]);

  if (status === 'loading' || loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="spin" style={{ width: 32, height: 32 }} />
    </div>
  );

  if (!session) return null;

  const initials = session.user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'S';
  const needsAttention = orders.filter(o =>
    o.stageIndex === 0 || o.stageIndex === 1
  ).length;
  const readyToShip = orders.filter(o =>
    o.stages?.[o.stageIndex]?.key === 'ready_to_ship'
  ).length;
  const needsReply = orders.filter(o => o.messageStatus === 'Needs Reply').length;

  return (
    <>
      <Head><title>Admin — Summit Portal</title></Head>
      <div id="app" style={{ display: 'block' }}>
        {/* Top Bar */}
        <div className="top">
          <div className="brand">
            <div className="logo" style={{ width: 30, height: 30, borderRadius: 8 }} />
            <b style={{ fontSize: 15 }}>Summit Sensory Gym</b>
          </div>
          <span className="scope adm">Admin</span>
          <div style={{ flex: 1 }} />
          <div className="who">
            <div className="av">{initials}</div>
            <span style={{ fontSize: 13 }}>{session.user.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => signOut({ callbackUrl: '/' })}>Sign out</button>
          </div>
        </div>

        {/* Layout */}
        <div className="lay">
          <nav className="side">
            <div className="nav">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  className={activeTab === tab.id ? 'on' : ''}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="ni">{tab.icon}</span>
                  {tab.label}
                  {tab.id === 'orders' && needsAttention > 0 && (
                    <span className="badge">{needsAttention}</span>
                  )}
                  {tab.id === 'messages' && needsReply > 0 && (
                    <span className="badge" style={{ background: 'var(--rose)' }}>{needsReply}</span>
                  )}
                </button>
              ))}
            </div>
          </nav>

          <main className="main">
            {activeTab === 'dashboard' && (
              <DashboardTab orders={orders} needsAttention={needsAttention} readyToShip={readyToShip} onNav={setActiveTab} />
            )}
            {activeTab === 'orders' && (
              <OrdersTab orders={orders} onRefresh={loadOrders} showToast={showToast} />
            )}
            {activeTab === 'customers' && (
              <CustomersTab orders={orders} />
            )}
            {activeTab === 'files' && (
              <FileManagerTab orders={orders} showToast={showToast} />
            )}
            {activeTab === 'messages' && (
              <AdminMessagesTab orders={orders} showToast={showToast} />
            )}
            {activeTab === 'settings' && (
              <SettingsTab showToast={showToast} />
            )}
          </main>
        </div>
      </div>
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardTab({ orders, needsAttention, readyToShip, onNav }) {
  const urgent = orders.filter(o => o.stageIndex <= 1);
  return (
    <>
      <div className="ph"><h2>Dashboard</h2><p>Overview of all active orders.</p></div>
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="k">Open Orders</div>
          <div className="v">{orders.length}</div>
          <div className="s">total active</div>
        </div>
        <div className="card stat">
          <div className="k">Need Attention</div>
          <div className="v" style={{ color: needsAttention > 0 ? 'var(--rose)' : 'var(--ok)' }}>{needsAttention}</div>
          <div className="s">deposit or forms pending</div>
        </div>
        <div className="card stat">
          <div className="k">Ready to Ship</div>
          <div className="v" style={{ color: readyToShip > 0 ? 'var(--sun)' : 'var(--mut)' }}>{readyToShip}</div>
          <div className="s">awaiting shipment</div>
        </div>
      </div>
      {urgent.length > 0 && (
        <div className="card">
          <div className="ch">
            <h3>🔴 Needs Attention</h3>
            <button className="lk" onClick={() => onNav('orders')}>View all orders</button>
          </div>
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th></tr></thead>
            <tbody>
              {urgent.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.name}</td>
                  <td style={{ color: 'var(--mut)' }}>{o.customerEmail || '—'}</td>
                  <td><StatusPill status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Orders ────────────────────────────────────────────────────────────────────

// Columns that are always visible and not toggleable
const FIXED_COLS = ['_name', '_actions'];

// Default columns shown on first visit
const DEFAULT_COL_IDS = ['_name', 'email__1', 'color_mkvw7b8', 'status__1', '_progress', 'lookup_mm1kcbb5', '_balance', '_actions'];

// Setup-progress checklist — Contact/Billing/Delivery/Colors/Documents, so staff
// can see at a glance what a customer still needs help finishing.
const PROGRESS_STEPS = [
  { key: 'contact',   label: 'Contact' },
  { key: 'billing',   label: 'Billing' },
  { key: 'delivery',  label: 'Delivery' },
  { key: 'colors',    label: 'Colors' },
  { key: 'documents', label: 'Documents' },
];

function getCellValue(order, colId) {
  // Special virtual columns
  if (colId === '_name') return { type: 'name', value: order.name };
  if (colId === '_balance') return { type: 'balance', value: order.balance };
  if (colId === '_progress') return { type: 'progress', value: order.progress };
  if (colId === '_actions') return { type: 'actions' };
  // Known parsed fields
  const knownMap = {
    'email__1':           order.customerEmail,
    'color_mkvw7b8':      order.productType,
    'status__1':          order.status,
    'lookup_mm1kcbb5':    order.trackingNumber,
    'date_mkvvpex1':      order.shipDate,
    'long_text_mkpkdtj4': order.address,
    'text_mm4wfamc':      order.invoiceLink,
    'lookup_mkwaee43':    order.phone,
    'lookup_mkwb5bty':    order.pocName,
    'lookup_mkwazctw':    order.pocEmail,
    'lookup_mkvx85hs':    order.firstName,
    'lookup_mm0anh5a':    order.deliveryInstructions,
  };
  if (colId in knownMap) return { type: 'text', value: knownMap[colId] };
  // Fall back to raw Monday.com column data
  return { type: 'text', value: order.rawColumns?.[colId]?.text || '' };
}

function OrdersTab({ orders, onRefresh, showToast }) {
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  // PORTAL-021: lets staff see a completed Delivery & Site Details submission
  // right in the Orders table (from order.deliverySnapshot, already parsed
  // by getAllOrders) instead of having to open the Delivery & Site Details
  // Submissions board in Monday and scan past blank rows for orders that
  // haven't submitted yet.
  const [expandedDelivery, setExpandedDelivery] = useState(null);
  const [expandedColors, setExpandedColors] = useState(null);
  const [availableCols, setAvailableCols] = useState([]);
  const [selectedColIds, setSelectedColIds] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('summit_admin_columns');
        return saved ? JSON.parse(saved) : DEFAULT_COL_IDS;
      } catch { return DEFAULT_COL_IDS; }
    }
    return DEFAULT_COL_IDS;
  });

  // Fetch available columns from Monday.com when picker opens
  useEffect(() => {
    if (!showPicker || availableCols.length > 0) return;
    fetch('/api/monday/columns')
      .then(r => r.json())
      .then(d => {
        // Prepend virtual columns
        const virtual = [
          { id: '_name', title: 'Order Name', type: 'name' },
          { id: '_balance', title: 'Balance Due', type: 'balance' },
          { id: '_progress', title: 'Setup Progress', type: 'progress' },
          { id: '_actions', title: 'Actions', type: 'actions' },
        ];
        setAvailableCols([...virtual, ...(d.columns || [])]);
      })
      .catch(() => {});
  }, [showPicker, availableCols.length]);

  function toggleCol(colId) {
    if (FIXED_COLS.includes(colId)) return;
    setSelectedColIds(prev =>
      prev.includes(colId) ? prev.filter(id => id !== colId) : [...prev, colId]
    );
  }

  function saveColumns() {
    localStorage.setItem('summit_admin_columns', JSON.stringify(selectedColIds));
    setShowPicker(false);
    showToast('Column preferences saved.');
  }

  const STATUS_OPTIONS = [
    'Order Placed', 'Deposit Received', 'In Manufacturing',
    'Ready to Ship', 'Shipped', 'Delivered',
  ];

  function startEdit(order) {
    setEditing(prev => ({
      ...prev,
      [order.id]: { status: order.status, trackingNumber: order.trackingNumber || '' },
    }));
  }

  async function sendInvite(order) {
    if (!order.customerEmail) { showToast('This order has no customer email.'); return; }
    if (!confirm(`Send portal invitation to ${order.customerEmail}?`)) return;
    try {
      const res = await fetch('/api/portal/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      if (!res.ok) throw new Error();
      showToast(`✅ Invitation sent to ${order.customerEmail}`);
    } catch {
      showToast('Failed to send invitation. Please try again.');
    }
  }

  // Three notification templates that existed in lib/email.js but had no way
  // for staff to actually trigger them from the admin UI — notify-installation.js
  // (EM-07) was a live endpoint nobody could reach, and EM-05/EM-06 were fully
  // built but literally unwired to any trigger at all (Customer-Portal-Process-Flow.md
  // OPEN-2). All three now share one small "Notify…" control below.
  async function notifyByEmail(order, endpoint, label, extraBody) {
    if (!order.customerEmail) { showToast('This order has no customer email.'); return; }
    if (!confirm(`Send "${label}" email to ${order.customerEmail}?`)) return;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, ...extraBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Send failed.');
      showToast(`✅ ${label} sent to ${order.customerEmail}`);
    } catch (err) {
      showToast(err.message || 'Failed to send. Please try again.');
    }
  }

  function handleNotifyChoice(order, action) {
    if (action === 'installation') {
      notifyByEmail(order, '/api/admin/notify-installation', 'Installation Materials Ready');
    } else if (action === 'color') {
      notifyByEmail(order, '/api/admin/notify-color-form', 'Color Selection Form Ready');
    } else if (action === 'task') {
      const taskName = prompt('What does the customer need to do? (e.g. "Sign the updated freight quote")');
      if (taskName && taskName.trim()) {
        notifyByEmail(order, '/api/admin/notify-task', `Action Required: ${taskName.trim()}`, { taskName: taskName.trim() });
      }
    }
  }

  async function viewAsCustomer(order) {
    if (!order.customerEmail) { showToast('This order has no customer email — nothing to view as.'); return; }
    if (!confirm(`View the portal as ${order.customerEmail} for "${order.name}"? This starts a 2-hour session logged to the order.`)) return;
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start session.');
      window.location.href = data.redirectTo || '/portal';
    } catch (err) {
      showToast(err.message || 'Failed to start viewing session. Please try again.');
    }
  }

  async function saveOrder(orderId) {
    const changes = editing[orderId];
    if (!changes) return;
    setSaving(orderId);
    try {
      const res = await fetch(`/api/monday/orders?id=${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      // Some fields (tracking number, balance) can be individually skipped
      // server-side if their Monday column env var isn't configured — that's
      // real, actionable information, not something to hide behind a generic
      // success toast (see PATCH /api/monday/orders.js).
      showToast(data.warnings?.length ? data.warnings.join(' ') : 'Order updated.');
      setEditing(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      await onRefresh();
    } catch {
      showToast('Failed to save. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  // Build the ordered list of columns to display
  const displayCols = availableCols.length > 0
    ? selectedColIds.map(id => availableCols.find(c => c.id === id)).filter(Boolean)
    : selectedColIds.map(id => ({ id, title: id === '_name' ? 'Order' : id === '_balance' ? 'Balance' : id === '_actions' ? '' : id }));

  return (
    <>
      <div className="ph" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2>Orders</h2>
          <p>All active orders. Edit status and tracking numbers inline.</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowPicker(true)}
          style={{ marginTop: 4, whiteSpace: 'nowrap' }}
        >
          ⚙️ Customize Columns
        </button>
      </div>

      {/* Column picker drawer */}
      {showPicker && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
        }}>
          {/* Backdrop */}
          <div
            onClick={() => setShowPicker(false)}
            style={{ flex: 1, background: 'rgba(0,0,0,.3)' }}
          />
          {/* Drawer */}
          <div style={{
            width: 340, background: '#fff', display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
          }}>
            <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Customize Columns</div>
                <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>Choose which columns appear in the orders table.</div>
              </div>
              <button onClick={() => setShowPicker(false)} style={{ color: 'var(--mut)', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
              {availableCols.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mut)' }}>
                  <div className="spin" style={{ margin: '0 auto 10px' }} />
                  Loading columns…
                </div>
              ) : (
                availableCols.map(col => {
                  const isFixed = FIXED_COLS.includes(col.id);
                  const isChecked = selectedColIds.includes(col.id);
                  return (
                    <label
                      key={col.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 20px', cursor: isFixed ? 'default' : 'pointer',
                        background: isChecked ? 'var(--moss-lt)' : 'transparent',
                        opacity: isFixed ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isFixed}
                        onChange={() => toggleCol(col.id)}
                        style={{ width: 16, height: 16, accentColor: 'var(--moss)' }}
                      />
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{col.title}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--mut)', textTransform: 'capitalize' }}>{col.type}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
              <button className="btn btn-moss" style={{ flex: 1 }} onClick={saveColumns}>Save</button>
              <button className="btn btn-ghost" onClick={() => setShowPicker(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="card pad0">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {displayCols.map(col => (
                  <th key={col.id}>{col.id === '_actions' ? '' : col.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const ed = editing[order.id];
                return (
                  <Fragment key={order.id}>
                  <tr>
                    {displayCols.map(col => {
                      const cell = getCellValue(order, col.id);

                      if (cell.type === 'name') return (
                        <td key={col.id} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{order.name}</td>
                      );

                      // PORTAL-004: order.balance is null when the balance column isn't
                      // configured/populated in Monday, vs. a real 0 when it's genuinely
                      // paid off. Both used to render as "Paid" — null now shows as a
                      // neutral "—" so staff aren't told an unconfigured order is paid.
                      if (cell.type === 'balance' && order.balance == null) return (
                        <td key={col.id} style={{ whiteSpace: 'nowrap', color: 'var(--muted, #888)' }}>—</td>
                      );

                      if (cell.type === 'balance') return (
                        <td key={col.id} style={{ fontWeight: 600, whiteSpace: 'nowrap', color: order.balance > 0 ? 'var(--rose)' : 'var(--ok)' }}>
                          {order.balance > 0 ? `$${order.balance.toFixed(2)}` : 'Paid'}
                        </td>
                      );

                      if (cell.type === 'progress') return (
                        <td key={col.id}><ProgressDots progress={cell.value} /></td>
                      );

                      if (cell.type === 'actions') return (
                        <td key={col.id}>
                          {ed ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-moss btn-sm" onClick={() => saveOrder(order.id)} disabled={saving === order.id}>
                                {saving === order.id ? '…' : 'Save'}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(prev => { const n = { ...prev }; delete n[order.id]; return n; })}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(order)}>Edit</button>
                              <button className="btn btn-ghost btn-sm" title="Send portal invitation" onClick={() => sendInvite(order)} style={{ whiteSpace: 'nowrap' }}>
                                ✉️ Invite
                              </button>
                              <button className="btn btn-ghost btn-sm" title="View/act in this customer's portal to help them complete a step or troubleshoot an issue" onClick={() => viewAsCustomer(order)} style={{ whiteSpace: 'nowrap' }}>
                                👁️ View as Customer
                              </button>
                              {order.deliverySnapshot && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  title="View this customer's submitted delivery & site details"
                                  onClick={() => setExpandedDelivery(prev => (prev === order.id ? null : order.id))}
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  🚚 Delivery {expandedDelivery === order.id ? '▲' : '▼'}
                                </button>
                              )}
                              {order.colorSelectionSnapshot && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  title="View this customer's selected colors/finishes"
                                  onClick={() => setExpandedColors(prev => (prev === order.id ? null : order.id))}
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  🎨 Colors {expandedColors === order.id ? '▲' : '▼'}
                                </button>
                              )}
                              <select
                                className="btn btn-ghost btn-sm"
                                value=""
                                title="Send a one-off customer notification"
                                style={{ whiteSpace: 'nowrap' }}
                                onChange={e => { const action = e.target.value; e.target.value = ''; if (action) handleNotifyChoice(order, action); }}
                              >
                                <option value="" disabled>✉️ Notify…</option>
                                <option value="installation">Installation Ready</option>
                                <option value="color">Color Form Ready</option>
                                <option value="task">Task Due…</option>
                              </select>
                            </div>
                          )}
                        </td>
                      );

                      // Status column — editable when in edit mode
                      if (col.id === 'status__1') return (
                        <td key={col.id}>
                          {ed ? (
                            <select
                              value={ed.status}
                              onChange={e => setEditing(prev => ({ ...prev, [order.id]: { ...prev[order.id], status: e.target.value } }))}
                              style={{ width: 160 }}
                            >
                              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                            </select>
                          ) : (
                            <StatusPill status={order.status} />
                          )}
                        </td>
                      );

                      // Tracking number — editable when in edit mode
                      if (col.id === 'lookup_mm1kcbb5') return (
                        <td key={col.id}>
                          {ed ? (
                            <input
                              type="text"
                              value={ed.trackingNumber}
                              placeholder="FedEx tracking #"
                              onChange={e => setEditing(prev => ({ ...prev, [order.id]: { ...prev[order.id], trackingNumber: e.target.value } }))}
                              style={{ width: 160 }}
                            />
                          ) : (
                            <span style={{ fontSize: 13, color: order.trackingNumber ? 'var(--ink)' : 'var(--mut)' }}>
                              {order.trackingNumber || '—'}
                            </span>
                          )}
                        </td>
                      );

                      // Generic text cell
                      return (
                        <td key={col.id} style={{ fontSize: 13, color: cell.value ? 'var(--ink)' : 'var(--mut)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cell.value || '—'}
                        </td>
                      );
                    })}
                  </tr>
                  {expandedDelivery === order.id && order.deliverySnapshot && (
                    <tr>
                      <td colSpan={displayCols.length} style={{ background: '#f7f9f5', padding: 0 }}>
                        <DeliveryDetailPanel order={order} />
                      </td>
                    </tr>
                  )}
                  {expandedColors === order.id && order.colorSelectionSnapshot && (
                    <tr>
                      <td colSpan={displayCols.length} style={{ background: '#f7f9f5', padding: 0 }}>
                        <ColorSelectionDetailPanel order={order} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && (
          <div className="empty"><div className="ei">📦</div><h3>No orders</h3><p>Orders from Monday.com will appear here.</p></div>
        )}
      </div>
    </>
  );
}

// PORTAL-021: read-only summary of a customer's submitted Delivery & Site
// Details, rendered inline in the Orders table from order.deliverySnapshot
// (already parsed JSON — see COLS.deliverySnapshot in lib/monday.js). This
// is what lets staff see a completed submission without opening the
// Delivery & Site Details Submissions board in Monday. Some checkbox-style
// fields have been observed serialized inconsistently (`true`, `"v"`, or
// `{ checked: true }`) depending on when they were written — isChecked()
// normalizes all three so this panel doesn't misread a checked box as blank.
function isChecked(v) {
  return v === true || v === 'v' || (v && typeof v === 'object' && v.checked === true);
}

function DeliveryField({ label, value }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 11, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>{value === undefined || value === null || value === '' ? '—' : value}</div>
    </div>
  );
}

function DeliveryDetailPanel({ order }) {
  const s = order.deliverySnapshot || {};

  return (
    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>
        🚚 Delivery &amp; Site Details — {order.name}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', marginBottom: 14 }}>
        <DeliveryField label="Primary Contact" value={s.pocName} />
        <DeliveryField label="Phone" value={s.pocPhone} />
        <DeliveryField label="Can Text?" value={isChecked(s.phoneCanText) ? 'Yes' : 'No'} />
        <DeliveryField label="Email" value={s.pocEmail} />
      </div>

      {isChecked(s.hasSecondaryPoc) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', marginBottom: 14 }}>
          <DeliveryField label="Secondary Contact" value={s.secondaryPocName} />
          <DeliveryField label="Phone" value={s.secondaryPocPhone} />
          <DeliveryField label="Can Text?" value={isChecked(s.secondaryPhoneCanText) ? 'Yes' : 'No'} />
          <DeliveryField label="Email" value={s.secondaryPocEmail} />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', marginBottom: 14 }}>
        <DeliveryField label="Loading Dock" value={isChecked(s.hasLoadingDock) ? 'Yes' : 'No'} />
        <DeliveryField label="Delivery Timing" value={s.deliveryTiming} />
        <DeliveryField label="Preferred Date" value={s.preferredDeliveryDate} />
      </div>

      {s.addressConfirmed === false && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 28px', marginBottom: 14 }}>
          <DeliveryField label="Ship-To Address" value={[s.addressLine1, s.addressLine2, s.addressCity, [s.addressState, s.addressZip].filter(Boolean).join(' '), s.addressCountry].filter(Boolean).join(', ') || undefined} />
        </div>
      )}

      {s.specialInstructions && (
        <div style={{ marginBottom: 14, maxWidth: 640 }}>
          <div style={{ fontSize: 11, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Special Instructions</div>
          <div style={{ fontSize: 13.5, marginTop: 2 }}>{s.specialInstructions}</div>
        </div>
      )}

      {s.ackName && (
        <div style={{ fontSize: 12, color: 'var(--mut)' }}>✓ Acknowledged by {s.ackName}</div>
      )}
    </div>
  );
}

// Details, rendered inline in the Orders table from order.colorSelectionSnapshot
// — same reasoning as DeliveryDetailPanel above: staff can review exactly what
// a customer picked without leaving this table (previously required opening
// Jotform's own dashboard, with no link from here to the right submission at
// all). Resolves each stored {brand, code} pair back to a real catalog entry
// server-side data was already validated against, rather than trusting
// whatever's in the snapshot at face value — via the same resolveSelectedColor
// lib/colorCatalog.js already exports (this file used to reimplement the
// identical brand-switch lookup under a local name; a real duplication a
// code review flagged, since a future change to brand-resolution could be
// applied everywhere except here).
function ColorSelectionDetailPanel({ order }) {
  const s = order.colorSelectionSnapshot || {};
  const inputs = requiredColorInputs(order.productType) || [];
  const orphans = findOrphanedSelections(inputs, s.selections || {});

  return (
    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>
        🎨 Color &amp; Product Selections — {order.name}
      </div>

      {inputs.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--mut)' }}>
          This order&apos;s product type isn&apos;t configured for the native picker — selections shown here may be incomplete or from an earlier configuration.
        </div>
      )}

      {inputs.map((input) => (
        <div key={input.input} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--mut)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 6 }}>
            {input.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
            {input.parts.map((part) => {
              const color = resolveSelectedColor(s.selections?.[input.input]?.[part]);
              return (
                <div key={part} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                  {color && (
                    color.photo
                      ? <img src={color.photo} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover', flex: 'none' }} />
                      : <span style={{ width: 20, height: 20, borderRadius: 4, background: color.hex, border: '1px solid var(--line)', flex: 'none', display: 'inline-block' }} />
                  )}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--mut)' }}>{PART_LABELS[part] || part}</div>
                    <div style={{ fontSize: 13 }}>{color ? `${displayColorName(color)}${color.code || color.sku ? ` (${color.code || color.sku})` : ''}` : '—'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {orphans.length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--sun-lt, #FEF3C7)', borderRadius: 6, border: '1px solid var(--sun, #F59E0B)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 6 }}>
            ⚠️ Other saved selections (don&apos;t match this order&apos;s current product type)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
            {orphans.map(({ inputKey, partKey, color }) => (
              <div key={`${inputKey}.${partKey}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                {color.photo
                  ? <img src={color.photo} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover', flex: 'none' }} />
                  : <span style={{ width: 20, height: 20, borderRadius: 4, background: color.hex, border: '1px solid var(--line)', flex: 'none', display: 'inline-block' }} />}
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mut)' }}>{PART_LABELS[partKey] || partKey}</div>
                  <div style={{ fontSize: 13 }}>{displayColorName(color)}{color.code || color.sku ? ` (${color.code || color.sku})` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px 28px', flexWrap: 'wrap', marginTop: 4 }}>
        <DeliveryField label="Total Upcharge" value={typeof s.totalUpcharge === 'number' ? `$${s.totalUpcharge.toLocaleString()}` : undefined} />
        <DeliveryField label="Confirmed" value={s.confirmedAt ? new Date(s.confirmedAt).toLocaleString() : 'Not yet confirmed'} />
      </div>
    </div>
  );
}

// ── Customers ─────────────────────────────────────────────────────────────────

function CustomersTab({ orders }) {
  return (
    <>
      <div className="ph"><h2>Customers</h2><p>Customer list with form completion and balance status.</p></div>
      <div className="card pad0">
        <table>
          <thead>
            <tr><th>Customer</th><th>Order</th><th>Product</th><th>Setup Progress</th><th>Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{order.contactName || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--mut)' }}>{order.customerEmail}</div>
                </td>
                <td style={{ fontSize: 13 }}>{order.name}</td>
                <td style={{ fontSize: 13, color: 'var(--mut)' }}>{order.productType || '—'}</td>
                <td><ProgressDots progress={order.progress} /></td>
                {/* PORTAL-004: distinguish "no balance data" (null) from "$0 / paid" */}
                <td style={{ fontWeight: 600, color: order.balance == null ? 'var(--mut)' : order.balance > 0 ? 'var(--rose)' : 'var(--ok)' }}>
                  {order.balance == null ? '—' : order.balance > 0 ? `$${order.balance.toFixed(2)}` : 'Paid'}
                </td>
                <td><StatusPill status={order.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── File Manager ──────────────────────────────────────────────────────────────

function FileManagerTab({ orders, showToast }) {
  const [selectedOrder, setSelectedOrder] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState('rendering');

  const CATEGORIES = [
    { value: 'rendering', label: '🖼️ Rendering' },
    { value: 'contract', label: '📝 Contract' },
    { value: 'invoice', label: '💰 Invoice' },
    { value: 'install_guide', label: '📋 Install Guide' },
    { value: 'other', label: '📄 Other' },
  ];

  async function loadFiles(orderId) {
    setFiles([]);
    if (!orderId) return;
    try {
      const res = await fetch(`/api/monday/files?orderId=${orderId}`);
      if (res.ok) setFiles((await res.json()).files || []);
    } catch {}
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!selectedOrder || !fileUrl || !fileName) return;
    setUploading(true);
    try {
      const fullName = `[${CATEGORIES.find(c => c.value === category)?.label.replace(/\S+\s/, '') || ''}] ${fileName}`;
      const res = await fetch('/api/monday/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selectedOrder, fileUrl, fileName: fullName }),
      });
      if (!res.ok) throw new Error();
      showToast('File shared with customer.');
      setFileUrl(''); setFileName('');
      await loadFiles(selectedOrder);
    } catch {
      showToast('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="ph"><h2>File Manager</h2><p>Upload and share files with customers.</p></div>
      <div className="grid g2">
        <div className="card">
          <div className="ch"><h3>Share a File</h3></div>
          <form onSubmit={handleUpload}>
            <div className="field">
              <label>Select Customer Order</label>
              <select value={selectedOrder} onChange={e => { setSelectedOrder(e.target.value); loadFiles(e.target.value); }}>
                <option value="">— Select an order —</option>
                {orders.map(o => <option key={o.id} value={o.id}>{o.name} ({o.customerEmail})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>File Name</label>
              <input type="text" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="e.g. Site Rendering v2" />
            </div>
            <div className="field">
              <label>File URL</label>
              <input type="text" value={fileUrl} onChange={e => setFileUrl(e.target.value)} placeholder="https://…" />
              <div className="hint">Paste a direct link to the file (from SharePoint, Google Drive, Dropbox, etc.).</div>
            </div>
            <button className="btn btn-moss" style={{ width: '100%' }} disabled={uploading || !selectedOrder || !fileUrl || !fileName}>
              {uploading ? 'Sharing…' : 'Share with Customer'}
            </button>
          </form>
        </div>
        <div className="card">
          <div className="ch"><h3>Shared Files {selectedOrder && `(${files.length})`}</h3></div>
          {!selectedOrder ? (
            <p style={{ color: 'var(--mut)', fontSize: 13.5 }}>Select an order to see its files.</p>
          ) : files.length === 0 ? (
            <div className="empty" style={{ padding: '20px 0' }}>
              <div className="ei">📁</div>
              <p>No files shared yet.</p>
            </div>
          ) : (
            files.map(file => (
              <div key={file.id} className="file">
                <div className="f-ic" style={{ background: 'var(--sky-lt)', color: 'var(--sky)' }}>📄</div>
                <div className="f-b">
                  <div className="t">{file.name}</div>
                  <div className="d">{file.created_at && new Date(file.created_at).toLocaleDateString()}</div>
                </div>
                <a href={file.public_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">View</a>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── Admin Messages ────────────────────────────────────────────────────────────

function AdminMessagesTab({ orders, showToast }) {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function loadMessages(order) {
    setSelectedOrder(order);
    setMessages([]);
    try {
      const res = await fetch(`/api/monday/messages?orderId=${order.id}`);
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch {}
  }

  async function send(e) {
    e.preventDefault();
    if (!body.trim() || !selectedOrder) return;
    setSending(true);
    try {
      const res = await fetch('/api/monday/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selectedOrder.id, body }),
      });
      if (!res.ok) throw new Error();
      setBody('');
      await loadMessages(selectedOrder);
      showToast('Message sent.');
    } catch {
      showToast('Failed to send.');
    } finally {
      setSending(false);
    }
  }

  // Needs-reply threads float to the top so staff can work the queue instead
  // of hunting through every order for new customer messages.
  const sortedOrders = [...orders].sort((a, b) => {
    const aNeeds = a.messageStatus === 'Needs Reply' ? 1 : 0;
    const bNeeds = b.messageStatus === 'Needs Reply' ? 1 : 0;
    return bNeeds - aNeeds;
  });

  return (
    <>
      <div className="ph"><h2>Messages</h2><p>Communicate with customers directly through their portal.</p></div>
      <div className="card pad0">
        <div className="msg-wrap">
          <div className="thr-list">
            {sortedOrders.map(o => (
              <div key={o.id} className={`thr${selectedOrder?.id === o.id ? ' on' : ''}`} onClick={() => loadMessages(o)}>
                <div className="n" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {o.messageStatus === 'Needs Reply' && (
                    <span title="Needs reply" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--rose)', flexShrink: 0, display: 'inline-block' }} />
                  )}
                  {o.name}
                </div>
                <div className="p">{o.customerEmail || 'No email'}</div>
              </div>
            ))}
          </div>
          <div className="chat">
            {!selectedOrder ? (
              <div className="chat-b" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div className="empty"><div className="ei">💬</div><h3>Select an order</h3><p>Choose a customer thread on the left.</p></div>
              </div>
            ) : (
              <>
                <div className="chat-h">{selectedOrder.name} · {selectedOrder.customerEmail}</div>
                <div className="chat-b">
                  {messages.length === 0 && (
                    <div className="empty" style={{ padding: '20px 0' }}>
                      <div className="ei">💬</div><h3>No messages</h3><p>Start the conversation below.</p>
                    </div>
                  )}
                  {messages.map(msg => {
                    // 2026-08-18: this used to read msg.creator?.email/.name
                    // directly — but Monday's create_update API always
                    // attributes the update to whoever owns MONDAY_API_TOKEN,
                    // never to the actual sender, so every message (customer
                    // or staff) showed up here as "Bryan Shepherd." Now reads
                    // the same origin tag /api/monday/messages.js stamps into
                    // the body, via the shared helper in lib/messageOrigin.js
                    // (the same one pages/portal/index.js's Messages tab
                    // uses) — and staff messages always display as the
                    // company name, never an individual's name, per Bryan.
                    const staff = isStaffMessage(msg);
                    const displayName = messageDisplayName(staff, selectedOrder);
                    return (
                      <div key={msg.id}>
                        <div className={`bub ${staff ? 'me' : 'them'}`}>
                          <div style={{ fontSize: 11, opacity: .7, marginBottom: 3 }}>{displayName}</div>
                          {/* PORTAL-002: sanitized before injection — see lib/sanitizeHtml.js */}
                          <div dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(stripPortalTags(msg.body)) }} />
                          <div className="ts">{new Date(msg.created_at).toLocaleString()}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form className="chat-i" onSubmit={send}>
                  <input
                    type="text"
                    placeholder="Reply to customer…"
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    disabled={sending}
                  />
                  <button className="btn btn-moss btn-sm" disabled={sending || !body.trim()}>
                    {sending ? '…' : 'Send'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────
// SettingsTab and its sub-panels (Monday/Jotform/FedEx/Notifications/Auth/
// Branding/Users) moved to components/admin/SettingsTab.js (2026-08-19
// performance pass) and are loaded below via next/dynamic — most staff
// sessions never open Settings, so this tab's code shouldn't ship as part
// of every admin page load.

// ── Shared Components ─────────────────────────────────────────────────────────

/**
 * Compact 5-dot setup-progress readout (Contact/Billing/Delivery/Colors/
 * Documents) so staff can tell what a customer still needs help completing
 * without opening the order. Reads the same ✅/🚫/N/A labels the portal
 * itself writes via markSectionComplete.
 */
function ProgressDots({ progress }) {
  if (!progress) return <span style={{ color: 'var(--mut)' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {PROGRESS_STEPS.map(step => {
        const label = progress[step.key];
        const done = label === '✅';
        const na = label === 'N/A' || label === '';
        const color = done ? 'var(--ok)' : na ? 'var(--line)' : 'var(--rose)';
        return (
          <span
            key={step.key}
            title={`${step.label}: ${label || 'Not started'}`}
            style={{
              width: 9, height: 9, borderRadius: '50%',
              background: color, display: 'inline-block',
              flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--mut)' }}>—</span>;
  const colors = {
    'Order Placed':       { bg: 'var(--sky-lt)',  color: 'var(--sky)' },
    'Deposit Received':   { bg: 'var(--sun-lt)',  color: 'var(--sun)' },
    'In Manufacturing':   { bg: 'var(--moss-lt)', color: 'var(--moss-dk)' },
    'Ready to Ship':      { bg: '#fff3d4',         color: '#8a6200' },
    'Shipped':            { bg: 'var(--ok-lt)',   color: 'var(--ok)' },
    'Delivered':          { bg: 'var(--ok-lt)',   color: 'var(--ok)' },
  };
  const c = colors[status] || { bg: 'var(--paper)', color: 'var(--mut)' };
  return (
    <span className="pill" style={{ background: c.bg, color: c.color }}>
      <span className="dot" style={{ background: c.color }} />
      {status}
    </span>
  );
}
