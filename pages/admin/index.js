/**
 * Admin Portal — staff-only, protected by M365 SSO.
 * Sections: Dashboard, Orders, Customers, Files, Messages, Settings
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

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
const DEFAULT_COL_IDS = ['_name', 'email__1', 'color_mkvw7b8', 'status__1', 'lookup_mm1kcbb5', '_balance', '_actions'];

function getCellValue(order, colId) {
  // Special virtual columns
  if (colId === '_name') return { type: 'name', value: order.name };
  if (colId === '_balance') return { type: 'balance', value: order.balance };
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
      if (!res.ok) throw new Error('Save failed.');
      showToast('Order updated.');
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
                  <tr key={order.id}>
                    {displayCols.map(col => {
                      const cell = getCellValue(order, col.id);

                      if (cell.type === 'name') return (
                        <td key={col.id} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{order.name}</td>
                      );

                      if (cell.type === 'balance') return (
                        <td key={col.id} style={{ fontWeight: 600, whiteSpace: 'nowrap', color: order.balance > 0 ? 'var(--rose)' : 'var(--ok)' }}>
                          {order.balance > 0 ? `$${order.balance.toFixed(2)}` : 'Paid'}
                        </td>
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

// ── Customers ─────────────────────────────────────────────────────────────────

function CustomersTab({ orders }) {
  return (
    <>
      <div className="ph"><h2>Customers</h2><p>Customer list with form completion and balance status.</p></div>
      <div className="card pad0">
        <table>
          <thead>
            <tr><th>Customer</th><th>Order</th><th>Product</th><th>Balance</th><th>Status</th></tr>
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
                <td style={{ fontWeight: 600, color: order.balance > 0 ? 'var(--rose)' : 'var(--ok)' }}>
                  {order.balance > 0 ? `$${order.balance.toFixed(2)}` : 'Paid'}
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

  return (
    <>
      <div className="ph"><h2>Messages</h2><p>Communicate with customers directly through their portal.</p></div>
      <div className="card pad0">
        <div className="msg-wrap">
          <div className="thr-list">
            {orders.map(o => (
              <div key={o.id} className={`thr${selectedOrder?.id === o.id ? ' on' : ''}`} onClick={() => loadMessages(o)}>
                <div className="n">{o.name}</div>
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
                  {messages.map(msg => (
                    <div key={msg.id}>
                      <div className={`bub ${msg.creator?.email?.endsWith('summitsensorygym.com') ? 'me' : 'them'}`}>
                        <div style={{ fontSize: 11, opacity: .7, marginBottom: 3 }}>{msg.creator?.name}</div>
                        <div dangerouslySetInnerHTML={{ __html: msg.body }} />
                        <div className="ts">{new Date(msg.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
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

function SettingsTab({ showToast }) {
  const [tab, setTab] = useState('monday');
  const SETTING_TABS = [
    { id: 'monday',  label: 'Monday.com' },
    { id: 'jotform', label: 'Jotform' },
    { id: 'fedex',   label: 'FedEx' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'auth',    label: 'Authentication' },
    { id: 'branding', label: 'Branding' },
    { id: 'users',   label: 'Users & Access' },
  ];

  return (
    <>
      <div className="ph"><h2>Settings</h2><p>Configure integrations, notifications, and portal behavior.</p></div>
      <div className="tabs">
        {SETTING_TABS.map(t => (
          <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'monday' && <MondaySettings showToast={showToast} />}
      {tab === 'jotform' && <JotformSettings showToast={showToast} />}
      {tab === 'fedex' && <FedexSettings showToast={showToast} />}
      {tab === 'notifications' && <NotificationSettings />}
      {tab === 'auth' && <AuthSettings />}
      {tab === 'branding' && <BrandingSettings />}
      {tab === 'users' && <UsersSettings />}
    </>
  );
}

function MondaySettings({ showToast }) {
  const [boards, setBoards] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/monday/boards')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBoards(d.boards || []); })
      .catch(() => {});
  }, []);

  return (
    <div className="card">
      <div className="ch"><h3>Monday.com Integration</h3></div>
      <div className="alert success" style={{ marginBottom: 16 }}>
        <span>✅</span>
        <span>Connected. Board: <strong>{process.env.NEXT_PUBLIC_BOARD_NAME || 'Manufacturing Process'}</strong></span>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 20 }}>
        Column mappings are configured via environment variables in your Vercel project settings.
        To change which columns map to portal fields, update the <code>MONDAY_COL_*</code> variables
        in your Vercel dashboard and redeploy.
      </p>
      <div className="map-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Portal Field</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Monday.com Column ID</span>
      </div>
      {[
        ['Customer Email', 'MONDAY_COL_CUSTOMER_EMAIL'],
        ['Order Status', 'MONDAY_COL_STATUS'],
        ['Tracking Number', 'MONDAY_COL_TRACKING_NUMBER'],
        ['Portal Files', 'MONDAY_COL_PORTAL_FILES'],
        ['Balance', 'MONDAY_COL_BALANCE'],
        ['Invoice Link', 'MONDAY_COL_INVOICE_LINK'],
        ['Ship Date', 'MONDAY_COL_SHIP_DATE'],
        ['Product Type', 'MONDAY_COL_PRODUCT_TYPE'],
      ].map(([label, envVar]) => (
        <div key={envVar} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
          <span style={{ fontSize: 13.5 }}>{label}</span>
          <code style={{ fontSize: 12, background: 'var(--paper)', padding: '3px 6px', borderRadius: 5, color: 'var(--moss-dk)' }}>{envVar}</code>
        </div>
      ))}
    </div>
  );
}

function JotformSettings({ showToast }) {
  return (
    <div className="card">
      <div className="ch"><h3>Jotform Integration</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
        Map your products to their required Jotform forms. Each form ID and its configuration
        is stored in the <code>JOTFORM_FORM_MAP</code> environment variable as JSON.
      </p>
      <div className="alert info" style={{ marginBottom: 16 }}>
        <span>ℹ️</span>
        <div>
          <strong>Webhook URL:</strong><br />
          <code style={{ fontSize: 12 }}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/jotform/webhook</code>
          <p style={{ fontSize: 12, marginTop: 4, opacity: .8 }}>Add this URL to each Jotform form under Settings → Integrations → Webhooks.</p>
        </div>
      </div>
      <div className="alert warn">
        <span>⚙️</span>
        <div>
          <strong>Format for JOTFORM_FORM_MAP:</strong>
          <pre style={{ fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{`{
  "231234567890": {
    "name": "Site Assessment",
    "description": "Required before installation",
    "productTypes": ["Sensory Gym Package"],
    "completed": false
  },
  "231234567891": {
    "name": "Install Consent",
    "description": "Required for all orders"
  }
}`}</pre>
        </div>
      </div>
    </div>
  );
}

function FedexSettings() {
  return (
    <div className="card">
      <div className="ch"><h3>FedEx Tracking</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
        Once configured, live tracking will appear on customer portals automatically when a tracking number is entered.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {[
          { label: 'API Key', env: 'FEDEX_API_KEY', note: 'From your FedEx Developer account' },
          { label: 'Secret Key', env: 'FEDEX_SECRET_KEY', note: 'From your FedEx Developer account' },
          { label: 'Account Number', env: 'FEDEX_ACCOUNT_NUMBER', note: 'Your FedEx shipping account' },
        ].map(({ label, env, note }) => (
          <div key={env} className="field" style={{ marginBottom: 0 }}>
            <label>{label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <code style={{ flex: 1, padding: '8px 12px', background: 'var(--paper)', borderRadius: 8, border: '1px solid var(--line)', fontSize: 12, color: 'var(--moss-dk)' }}>{env}</code>
            </div>
            <div className="hint">{note} — set in Vercel environment variables.</div>
          </div>
        ))}
      </div>
      <div className="alert info" style={{ marginTop: 16 }}>
        <span>🔗</span>
        <span>Sign up for FedEx Track API at <a href="https://developer.fedex.com" target="_blank" rel="noreferrer" style={{ color: 'var(--sky)' }}>developer.fedex.com</a> using your FedEx account.</span>
      </div>
    </div>
  );
}

function NotificationSettings() {
  return (
    <div className="card">
      <div className="ch"><h3>Notifications</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 20 }}>All notifications are sent automatically. Configure the team email in <code>NOTIFY_TEAM_EMAIL</code>.</p>
      {[
        { label: 'Customer form completed', desc: 'Team is notified when a customer submits a required form', on: true },
        { label: 'Status change', desc: 'Customer is notified when their order status changes', on: true },
        { label: 'Balance change', desc: 'Customer is notified when their balance is updated', on: true },
        { label: 'New file shared', desc: 'Customer is notified when a file is shared with them', on: true },
        { label: 'New customer message', desc: 'Team is notified when a customer sends a message', on: true },
        { label: 'Contact info changed', desc: 'Team is alerted immediately when address, phone, or contact changes', on: true },
      ].map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>{item.desc}</div>
          </div>
          <div className={`toggle${item.on ? ' on' : ''}`} />
        </div>
      ))}
    </div>
  );
}

function AuthSettings() {
  return (
    <div className="card">
      <div className="ch"><h3>Authentication</h3></div>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Microsoft 365 SSO (Staff)</div>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>Staff log in via Azure AD. Restricted to <code>{process.env.NEXT_PUBLIC_STAFF_DOMAIN || 'summitsensorygym.com'}</code></div>
            </div>
            <div className="toggle on" />
          </div>
        </div>
        <div style={{ padding: '14px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Passwordless Email Login (Customers)</div>
              <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>Customers receive a 6-digit code via email. No password required.</div>
            </div>
            <div className="toggle on" />
          </div>
        </div>
      </div>
      <div className="alert info" style={{ marginTop: 16 }}>
        <span>ℹ️</span>
        <span>Configure Azure AD credentials (<code>AZURE_AD_*</code>) in your Vercel project settings.</span>
      </div>
    </div>
  );
}

function BrandingSettings() {
  return (
    <div className="card">
      <div className="ch"><h3>Branding</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 20 }}>Portal branding is configured in <code>styles/globals.css</code> via CSS variables.</p>
      <div className="field">
        <label>Primary Color</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#2f5d50', border: '2px solid var(--ink)' }} />
          <code style={{ fontSize: 12 }}>--moss: #2f5d50</code>
        </div>
        <div className="hint">Update the <code>--moss</code> variable in globals.css to change the primary brand color.</div>
      </div>
    </div>
  );
}

function UsersSettings() {
  return (
    <div className="card">
      <div className="ch"><h3>Users & Access</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
        Staff access is controlled through Microsoft 365. Any <strong>@{process.env.NEXT_PUBLIC_STAFF_DOMAIN || 'summitsensorygym.com'}</strong> user
        can log in. To restrict or grant access, manage users in your Microsoft 365 Admin Center or update the Azure AD app registration.
      </p>
      <div className="alert info">
        <span>ℹ️</span>
        <span>Access is automatically revoked when a staff member is offboarded in Microsoft 365 — no manual steps required.</span>
      </div>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────────

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
