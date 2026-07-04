/**
 * Customer Portal
 * Two navigation groups:
 *   ACCOUNT SETUP  — 5 sequential tabs customers complete once
 *   MY ORDER       — ongoing access to dashboard, status, files, messages, etc.
 */

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Script from 'next/script';

// ── Navigation config ─────────────────────────────────────────────────────────

const SETUP_TABS = [
  { id: 'contact',   label: 'Contact Information',       icon: '👤' },
  { id: 'billing',   label: 'Billing Information',        icon: '💳' },
  { id: 'delivery',  label: 'Delivery & Site Details',   icon: '🚚' },
  { id: 'color',     label: 'Color & Product Selections', icon: '🎨' },
  { id: 'documents', label: 'Required Documents',         icon: '📋' },
];

const ORDER_TABS = [
  { id: 'dashboard',    label: 'Dashboard',         icon: '🏠' },
  { id: 'status',       label: 'Order Status',       icon: '📦' },
  { id: 'installation', label: 'Installation',       icon: '🔧' },
  { id: 'files',        label: 'Files & Documents',  icon: '📄' },
  { id: 'invoice',      label: 'Invoice & Payment',  icon: '💰' },
  { id: 'messages',     label: 'Messages',           icon: '💬' },
  { id: 'contact_us',   label: 'Contact Us',         icon: '📞' },
];

// ── Main portal ───────────────────────────────────────────────────────────────

export default function CustomerPortal() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [order, setOrder] = useState(null);
  const [orders, setOrders] = useState(null);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [formMap, setFormMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [completions, setCompletions] = useState({});
  const [toast, setToast] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  function markComplete(tabId) {
    setCompletions(prev => {
      const next = { ...prev, [tabId]: true };
      if (typeof window !== 'undefined') {
        try { localStorage.setItem(`summit_setup_${order?.id}`, JSON.stringify(next)); } catch {}
      }
      return next;
    });
  }

  const loadOrder = useCallback(async () => {
    try {
      const res = await fetch('/api/monday/order');
      if (res.status === 401) { router.replace('/'); return; }
      const data = await res.json();

      if (data.orders && data.orders.length > 1) {
        // Multiple orders — show picker
        setOrders(data.orders);
      } else {
        const resolvedOrder = data.order || data.orders?.[0] || null;
        setOrder(resolvedOrder);

        // Load saved completions from localStorage
        try {
          const saved = localStorage.getItem(`summit_setup_${resolvedOrder?.id}`);
          if (saved) setCompletions(JSON.parse(saved));
        } catch {}
      }

      // Load form map
      const fmRes = await fetch('/api/settings/forms');
      if (fmRes.ok) setFormMap(await fmRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadFiles = useCallback(async () => {
    if (!order) return;
    try {
      const res = await fetch(`/api/monday/files?orderId=${order.id}`);
      if (res.ok) setFiles((await res.json()).files || []);
    } catch {}
  }, [order]);

  const loadMessages = useCallback(async () => {
    if (!order) return;
    try {
      const res = await fetch(`/api/monday/messages?orderId=${order.id}`);
      if (res.ok) setMessages((await res.json()).messages || []);
    } catch {}
  }, [order]);

  useEffect(() => { loadOrder(); }, [loadOrder]);
  useEffect(() => {
    if (order) { loadFiles(); loadMessages(); }
  }, [order, loadFiles, loadMessages]);
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="spin" style={{ width: 32, height: 32 }} />
    </div>
  );

  if (orders && !order) return <OrderPicker orders={orders} onSelect={o => {
    setOrder(o);
    setOrders(null);
    try {
      const saved = localStorage.getItem(`summit_setup_${o?.id}`);
      if (saved) setCompletions(JSON.parse(saved));
    } catch {}
  }} />;

  if (!order) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <h2>No order found</h2>
        <p style={{ color: 'var(--mut)', marginTop: 6 }}>We couldn't find an order linked to your email. Contact Summit Sensory Gym for help.</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => router.replace('/')}>Back to Login</button>
      </div>
    </div>
  );

  // Setup completion stats
  const setupComplete = SETUP_TABS.every(t => completions[t.id]);
  const setupCount = SETUP_TABS.filter(t => completions[t.id]).length;
  const setupTotal = SETUP_TABS.length;
  const unreadMessages = messages.filter(m =>
    !m.creator?.email?.includes('summitsensory') && !m.creator?.email?.includes('summitsensorygym')
  ).length;

  // Forms for this customer's product type
  const productForms = Object.entries(formMap).filter(([, f]) =>
    !f.productTypes || f.productTypes.includes(order.productType)
  );
  const colorForms = productForms.filter(([, f]) => f.tab === 'color_selection');
  const docForms = productForms.filter(([, f]) => f.tab === 'required_documents');

  return (
    <>
      <Head><title>{order.name} — Summit Portal</title></Head>
      {process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY}&libraries=places`}
          strategy="afterInteractive"
        />
      )}
      <div id="app" style={{ display: 'block' }}>

        {/* Top Bar */}
        <div className="top">
          <button className="mob-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">☰</button>
          <div className="brand">
            <img src="/logo.png" style={{ width: 30, height: 30, objectFit: 'contain' }} alt="Summit Sensory Gym" onError={e => { e.target.style.display = 'none'; }} />
            <b style={{ fontSize: 15 }}>Summit Sensory Gym</b>
          </div>
          <span className="scope cust">Customer</span>
          <div style={{ flex: 1 }} />
          <div className="who">
            <span style={{ fontSize: 12.5, color: 'var(--mut)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.name}</span>
            <a href="/api/auth/signout-customer" className="btn btn-ghost btn-sm">Sign out</a>
          </div>
        </div>

        {/* Layout */}
        <div className="lay">

          {/* Sidebar */}
          <nav className="side">
            <div className="nav">

              {/* Setup progress bar */}
              <div style={{ padding: '12px 12px 4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--mut)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>
                  <span>Account Setup</span>
                  <span style={{ color: setupComplete ? 'var(--ok)' : 'var(--sun)' }}>{setupCount}/{setupTotal}</span>
                </div>
                <div className="prog">
                  <i style={{ width: `${Math.round((setupCount / setupTotal) * 100)}%` }} />
                </div>
              </div>

              {SETUP_TABS.map((tab, i) => {
                const done = completions[tab.id];
                const isActive = activeTab === tab.id;
                const needsAction = !done;
                return (
                  <button
                    key={tab.id}
                    className={activeTab === tab.id ? 'on' : ''}
                    onClick={() => setActiveTab(tab.id)}
                    style={{ position: 'relative' }}
                  >
                    <span className="ni" style={{ fontSize: 13 }}>
                      {done ? '✓' : tab.icon}
                    </span>
                    <span style={{ flex: 1, textAlign: 'left' }}>{tab.label}</span>
                    {done && (
                      <span style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,.7)' : 'var(--ok)', fontWeight: 700 }}>Done</span>
                    )}
                    {needsAction && !isActive && (
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: 'var(--sun)', display: 'inline-block', flex: 'none'
                      }} title="Action needed" />
                    )}
                  </button>
                );
              })}

              <div className="lab">My Order</div>

              {ORDER_TABS.map(tab => (
                <button
                  key={tab.id}
                  className={activeTab === tab.id ? 'on' : ''}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="ni">{tab.icon}</span>
                  {tab.label}
                  {tab.id === 'messages' && unreadMessages > 0 && (
                    <span className="badge">{unreadMessages}</span>
                  )}
                </button>
              ))}
            </div>
          </nav>

          {/* Main content */}
          <main className="main">
            {activeTab === 'contact'      && <ContactTab      order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('billing')} />}
            {activeTab === 'billing'      && <BillingTab      order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('delivery')} onBack={() => setActiveTab('contact')} />}
            {activeTab === 'delivery'     && <DeliveryTab     order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('color')} onBack={() => setActiveTab('billing')} />}
            {activeTab === 'color'        && <ColorTab        order={order} completions={completions} markComplete={markComplete} showToast={showToast} colorForms={colorForms} onNext={() => setActiveTab('documents')} onBack={() => setActiveTab('delivery')} />}
            {activeTab === 'documents'    && <DocumentsTab    order={order} completions={completions} markComplete={markComplete} showToast={showToast} docForms={docForms} onNext={() => setActiveTab('dashboard')} onBack={() => setActiveTab('color')} />}
            {activeTab === 'dashboard'    && <DashboardTab    order={order} completions={completions} setupComplete={setupComplete} setupCount={setupCount} setupTotal={setupTotal} onNav={setActiveTab} />}
            {activeTab === 'status'       && <StatusTab       order={order} />}
            {activeTab === 'installation' && <InstallationTab order={order} onNav={setActiveTab} />}
            {activeTab === 'files'        && <FilesTab        files={files} />}
            {activeTab === 'invoice'      && <InvoiceTab      order={order} />}
            {activeTab === 'messages'     && <MessagesTab     order={order} messages={messages} onRefresh={loadMessages} showToast={showToast} />}
            {activeTab === 'contact_us'   && <ContactUsTab    onNav={setActiveTab} />}
          </main>
        </div>

        {/* Mobile navigation drawer */}
        {mobileNavOpen && (
          <div className="mob-overlay" onClick={() => setMobileNavOpen(false)} />
        )}
        <div className={`mob-drawer${mobileNavOpen ? ' open' : ''}`}>
          <div className="mob-drawer-head">
            <div className="brand">
              <img src="/logo.png" style={{ width: 24, height: 24, objectFit: 'contain' }} alt="" onError={e => { e.target.style.display = 'none'; }} />
              <b style={{ fontSize: 14 }}>Summit Sensory Gym</b>
            </div>
            <button className="mob-close" onClick={() => setMobileNavOpen(false)}>✕</button>
          </div>
          <div className="nav">
            {/* Setup progress */}
            <div style={{ padding: '12px 12px 4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--mut)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>
                <span>Account Setup</span>
                <span style={{ color: setupComplete ? 'var(--ok)' : 'var(--sun)' }}>{setupCount}/{setupTotal}</span>
              </div>
              <div className="prog">
                <i style={{ width: `${Math.round((setupCount / setupTotal) * 100)}%` }} />
              </div>
            </div>
            {SETUP_TABS.map(tab => {
              const done = completions[tab.id];
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={isActive ? 'on' : ''}
                  onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
                  style={{ position: 'relative' }}
                >
                  <span className="ni" style={{ fontSize: 13 }}>{done ? '✓' : tab.icon}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{tab.label}</span>
                  {done && <span style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,.7)' : 'var(--ok)', fontWeight: 700 }}>Done</span>}
                  {!done && !isActive && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sun)', display: 'inline-block', flex: 'none' }} />}
                </button>
              );
            })}
            <div className="lab">My Order</div>
            {ORDER_TABS.map(tab => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'on' : ''}
                onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
              >
                <span className="ni">{tab.icon}</span>
                {tab.label}
                {tab.id === 'messages' && unreadMessages > 0 && (
                  <span className="badge">{unreadMessages}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}

// ── Shared save helper ────────────────────────────────────────────────────────

async function saveSetup(tab, data) {
  const res = await fetch('/api/portal/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab, data }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || 'Save failed.');
  }
  return res.json();
}

// ── Tab: Contact Information ──────────────────────────────────────────────────

function ContactTab({ order, completions, markComplete, showToast, onNext }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(order.pocName || order.firstName || '');
  const [phone, setPhone] = useState(order.phone || '');
  const [email, setEmail] = useState(order.customerEmail || '');
  const [saving, setSaving] = useState(false);
  const [updateSubmitted, setUpdateSubmitted] = useState(false);

  async function submitUpdate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSetup('contact_update', { name, phone, email });
      setUpdateSubmitted(true);
      setEditing(false);
      showToast('Contact update submitted — our team will confirm within 1 business day.');
    } catch { showToast('Error saving. Please try again.'); }
    finally { setSaving(false); }
  }

  async function confirm() {
    setSaving(true);
    try {
      await saveSetup('contact', {});
      markComplete('contact');
      showToast('Contact information confirmed.');
      onNext();
    } catch { showToast('Error saving. Please try again.'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="ph"><h2>Contact Information</h2><p>Review and confirm the primary contact details for your order. If anything is incorrect, you can submit an update.</p></div>
      {completions.contact && <div className="alert success" style={{ marginBottom: 16 }}>✅ Contact information confirmed.</div>}
      {updateSubmitted && <div className="alert success" style={{ marginBottom: 16 }}>✅ Contact update submitted. Our team will review and confirm within 1 business day.</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Primary Contact</h3>
          {!editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>

        {editing ? (
          <form onSubmit={submitUpdate}>
            <div className="grid g2">
              <div className="field">
                <label>Full Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="field">
                <label>Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
              </div>
              <div className="field">
                <label>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 303 555 0100" />
              </div>
              <div className="field">
                <label>Organization</label>
                <input type="text" value={order.name ? order.name.split(' - ')[0] : ''} disabled style={{ opacity: 0.6 }} />
              </div>
            </div>
            <div className="alert info" style={{ marginTop: 12, marginBottom: 16 }}>
              <span>ℹ️</span>
              <span>Changes will be reviewed and confirmed by our team within 1 business day.</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn btn-moss btn-sm" disabled={saving}>{saving ? 'Submitting…' : 'Submit Changes'}</button>
            </div>
          </form>
        ) : (
          <div className="grid g2">
            <ReadField label="Name" value={order.pocName || order.firstName || '—'} />
            <ReadField label="Email" value={order.customerEmail || '—'} />
            <ReadField label="Phone" value={order.phone || '—'} />
            <ReadField label="Organization" value={order.name ? order.name.split(' - ')[0] : '—'} />
          </div>
        )}
      </div>

      <TabNav onNext={confirm} nextLabel={saving && !editing ? 'Saving…' : 'Confirm & Continue'} saving={saving && !editing} />
    </>
  );
}

// ── Tab: Billing Information ──────────────────────────────────────────────────

function BillingTab({ order, completions, markComplete, showToast, onNext, onBack }) {
  const [sameAsDelivery, setSameAsDelivery] = useState(false);
  const [billingAddress, setBillingAddress] = useState('');
  const [billingAddressSuite, setBillingAddressSuite] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingZip, setBillingZip] = useState('');
  const [billingCountry, setBillingCountry] = useState('');
  const [sameContact, setSameContact] = useState(false);
  const [billingName, setBillingName] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const streetRef = useRef(null);
  const autocompleteRef = useRef(null);

  // Google Places autocomplete on street address
  useEffect(() => {
    if (sameAsDelivery || !streetRef.current || typeof window === 'undefined' || !window.google?.maps?.places) return;
    autocompleteRef.current = new window.google.maps.places.Autocomplete(streetRef.current, {
      types: ['address'],
      fields: ['address_components'],
    });
    const listener = autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      if (!place.address_components) return;
      let street = '', city = '', state = '', zip = '', country = '';
      for (const c of place.address_components) {
        const t = c.types[0];
        if (t === 'street_number') street = c.long_name + ' ';
        if (t === 'route') street += c.long_name;
        if (t === 'locality' || t === 'postal_town') city = city || c.long_name;
        if (t === 'administrative_area_level_1') state = c.short_name;
        if (t === 'postal_code') zip = c.long_name;
        if (t === 'country') country = c.long_name;
      }
      setBillingAddress(street.trim());
      setBillingCity(city);
      setBillingState(state);
      setBillingZip(zip);
      setBillingCountry(country);
    });
    return () => { if (listener) window.google.maps.event.removeListener(listener); };
  }, [sameAsDelivery]);

  async function submit(e) {
    e.preventDefault();
    if (!sameAsDelivery && !billingAddress.trim()) {
      showToast('Please enter a billing address.');
      return;
    }
    if (!sameContact && (!billingName.trim() || !billingPhone.trim() || !billingEmail.trim())) {
      showToast('Please complete all billing contact fields.');
      return;
    }
    setSaving(true);
    try {
      await saveSetup('billing', {
        billingSameAsDelivery: sameAsDelivery,
        billingAddress, billingAddressSuite, billingCity, billingState, billingZip, billingCountry,
        billingContactSameAsPrimary: sameContact,
        billingName, billingPhone, billingEmail,
      });
      markComplete('billing');
      showToast('Billing information saved.');
      onNext();
    } catch { showToast('Error saving. Please try again.'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="ph"><h2>Billing Information</h2><p>Enter your billing address and the contact responsible for payment.</p></div>
      {completions.billing && <div className="alert success" style={{ marginBottom: 16 }}>✅ Billing information saved.</div>}
      <form onSubmit={submit}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Bill-To Address <span style={{ color: 'var(--rose)', fontWeight: 400 }}>*</span></h3></div>
          <label className="sw" style={{ marginBottom: 16, cursor: 'pointer' }}>
            <div className={`toggle${sameAsDelivery ? ' on' : ''}`} onClick={() => setSameAsDelivery(v => !v)} />
            <span>Same as delivery address</span>
          </label>
          {sameAsDelivery ? (
            <div style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 8, fontSize: 13.5, color: 'var(--mut)', border: '1px solid var(--line)' }}>
              {order.address || <em>No delivery address on file</em>}
            </div>
          ) : (
            <>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Street Address</label>
                <input
                  ref={streetRef}
                  type="text"
                  value={billingAddress}
                  onChange={e => setBillingAddress(e.target.value)}
                  placeholder="123 Main St"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="field">
                <label>Suite / Apt / Unit <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(optional)</span></label>
                <input
                  type="text"
                  value={billingAddressSuite}
                  onChange={e => setBillingAddressSuite(e.target.value)}
                  placeholder="Suite 100"
                />
              </div>
              <div className="row">
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> City</label>
                  <input type="text" value={billingCity} onChange={e => setBillingCity(e.target.value)} required />
                </div>
                <div className="field">
                  <label>State / Province / Region</label>
                  <input type="text" value={billingState} onChange={e => setBillingState(e.target.value)} placeholder="e.g. CO, Ontario, Bavaria" />
                </div>
                <div className="field" style={{ maxWidth: 140 }}>
                  <label>Zip / Postal Code</label>
                  <input type="text" value={billingZip} onChange={e => setBillingZip(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Country</label>
                <input type="text" value={billingCountry} onChange={e => setBillingCountry(e.target.value)} placeholder="United States" required />
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Billing Point of Contact <span style={{ color: 'var(--rose)', fontWeight: 400 }}>*</span></h3></div>
          <label className="sw" style={{ marginBottom: 16, cursor: 'pointer' }}>
            <div className={`toggle${sameContact ? ' on' : ''}`} onClick={() => setSameContact(v => !v)} />
            <span>Same as primary contact ({order.pocName || order.customerEmail})</span>
          </label>
          {!sameContact && (
            <>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Billing Contact Name</label>
                <input type="text" value={billingName} onChange={e => setBillingName(e.target.value)} placeholder="Full name" required />
              </div>
              <div className="row">
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Phone</label>
                  <input type="tel" value={billingPhone} onChange={e => setBillingPhone(e.target.value)} placeholder="+1 303 555 0100" required />
                </div>
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Email</label>
                  <input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} required />
                </div>
              </div>
            </>
          )}
        </div>

        <TabNav onBack={onBack} nextLabel={saving ? 'Saving…' : 'Save & Continue'} saving={saving} />
      </form>
    </>
  );
}

// ── Tab: Delivery Details ─────────────────────────────────────────────────────

function DeliveryTab({ order, completions, markComplete, showToast, onNext, onBack }) {
  // Lock logistics editing once order has shipped
  const shippedIdx = order.stages?.findIndex(s => s.key === 'shipped') ?? 3;
  const isShipped = order.stageIndex >= shippedIdx;

  const [pocName, setPocName] = useState(order.pocName || '');
  const [pocPhone, setPocPhone] = useState(order.phone || '');
  const [phoneCanText, setPhoneCanText] = useState(false);
  const [pocEmail, setPocEmail] = useState(order.pocEmail || '');
  const [specialInstructions, setSpecialInstructions] = useState(order.deliveryInstructions || '');
  const [deliveryAddress, setDeliveryAddress] = useState(order.address || '');
  const [windowAsap, setWindowAsap] = useState(false);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [commMethods, setCommMethods] = useState(['Email']);
  const [mobilePhone, setMobilePhone] = useState('');
  const [ackRead, setAckRead] = useState(false);
  const [ackName, setAckName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showRestrictionNote, setShowRestrictionNote] = useState(false);
  const [errors, setErrors] = useState({});
  // Edit mode: start in read-only if data is already populated
  const [editingPoc, setEditingPoc] = useState(!(order.pocName || order.phone));
  // Logistics: show form fields if not yet completed, read-only after first submission
  const [editingLogistics, setEditingLogistics] = useState(!completions.delivery);

  const today = new Date().toISOString().split('T')[0];

  function toggleCommMethod(v) {
    setCommMethods(prev => prev.includes(v) ? prev.filter(m => m !== v) : [...prev, v]);
  }

  function isWeekday(dateStr) {
    if (!dateStr) return true;
    const d = new Date(dateStr + 'T12:00:00');
    return d.getDay() !== 0 && d.getDay() !== 6;
  }

  function validate() {
    const e = {};
    if (!pocName.trim()) e.pocName = 'Required';
    if (!pocPhone.trim()) e.pocPhone = 'Required';
    if (!pocEmail.trim()) e.pocEmail = 'Required';
    if (!windowAsap) {
      if (!windowStart) e.windowStart = 'Required — or select "Deliver as early as possible"';
      else if (!isWeekday(windowStart)) e.windowStart = 'Must be a weekday';
      if (!windowEnd) e.windowEnd = 'Required — or select "Deliver as early as possible"';
      else if (!isWeekday(windowEnd)) e.windowEnd = 'Must be a weekday';
      if (windowStart && windowEnd && windowEnd < windowStart) e.windowEnd = 'End date must be after start date';
    }
    if (!ackRead) e.ackRead = 'Required';
    if (!ackName.trim()) e.ackName = 'Required';
    return e;
  }

  function getChangedRestricted() {
    const changed = [];
    if (deliveryAddress && deliveryAddress !== order.address) changed.push('Delivery Address');
    if (windowStart || windowEnd || windowAsap) changed.push('Preferred Delivery Window');
    return changed;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Open the relevant section so errors are visible
      if (errs.pocName || errs.pocPhone || errs.pocEmail) setEditingPoc(true);
      if (errs.windowStart || errs.windowEnd) setEditingLogistics(true);
      showToast('Please complete all required fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    const changedRestricted = getChangedRestricted();
    const deliveryWindow = windowAsap ? 'As early as possible'
      : (windowStart || windowEnd) ? `${windowStart || 'TBD'} to ${windowEnd || 'TBD'}`
      : '';
    try {
      await saveSetup('delivery', {
        pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
        commMethods, mobilePhone,
        deliveryAddress, deliveryWindow,
        changedRestricted,
      });
      await saveSetup('freight_ack', {
        acknowledgedBy: ackName,
        acknowledgedAt: new Date().toLocaleDateString(),
      });
      markComplete('delivery');
      if (changedRestricted.length > 0) setShowRestrictionNote(true);
      else { showToast('Delivery details saved.'); onNext(); }
    } catch { showToast('Error saving. Please try again.'); }
    finally { setSaving(false); }
  }

  if (showRestrictionNote) return (
    <>
      <div className="ph"><h2>Delivery Details</h2></div>
      <div className="card">
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <h3 style={{ marginBottom: 8 }}>Changes Submitted for Confirmation</h3>
          <p style={{ color: 'var(--mut)', maxWidth: 420, margin: '0 auto 20px', fontSize: 14 }}>
            Some of your delivery changes require confirmation from our team before taking effect. We'll review and reach out within 1 business day.
          </p>
          <p style={{ color: 'var(--mut)', fontSize: 13 }}>Changes pending confirmation: {getChangedRestricted().join(', ')}</p>
          <button className="btn btn-moss" style={{ marginTop: 20 }} onClick={onNext}>Continue to Color Selections →</button>
        </div>
      </div>
    </>
  );

  // Order already shipped — logistics are locked
  if (isShipped) return (
    <>
      <div className="ph"><h2>Delivery Details</h2></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="alert warn">
          <span>🚚</span>
          <div>
            <strong>Your order has already shipped.</strong>
            <p style={{ margin: '6px 0 0', fontSize: 13.5 }}>
              Delivery details can no longer be changed through the portal. If you need to make a change, please contact the Summit Sensory Gym team immediately.
            </p>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <a href="tel:+17204575500" className="btn btn-moss" style={{ display: 'inline-flex' }}>
            📞 Call (720) 457-5500 →
          </a>
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
    </>
  );

  return (
    <>
      <div className="ph"><h2>Delivery & Site Details</h2><p>Confirm how and where your order will be delivered, and verify your site is ready to receive it.</p></div>
      {completions.delivery && <div className="alert success" style={{ marginBottom: 16 }}>✅ Delivery and site details confirmed.</div>}
      <form onSubmit={submit}>

        {/* Primary Delivery POC */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Primary Delivery Point of Contact</h3>
            {!editingPoc && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingPoc(true)}>Edit</button>
            )}
          </div>
          {editingPoc ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 16 }}>The person who will be on-site to receive the delivery.</p>
              <div className="row">
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Full Name</label>
                  <input type="text" value={pocName} onChange={e => { setPocName(e.target.value); setErrors(v => ({...v, pocName: ''})); }} style={{ borderColor: errors.pocName ? 'var(--rose)' : '' }} />
                  {errors.pocName && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.pocName}</div>}
                </div>
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Direct Phone</label>
                  <input type="tel" value={pocPhone} onChange={e => { setPocPhone(e.target.value); setErrors(v => ({...v, pocPhone: ''})); }} placeholder="+1 303 555 0100" style={{ borderColor: errors.pocPhone ? 'var(--rose)' : '' }} />
                  {errors.pocPhone && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.pocPhone}</div>}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, cursor: 'pointer', fontWeight: 400 }}>
                    <input type="checkbox" checked={phoneCanText} onChange={e => setPhoneCanText(e.target.checked)} style={{ width: 'auto' }} />
                    This number can receive text messages
                  </label>
                </div>
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Email</label>
                <input type="email" value={pocEmail} onChange={e => { setPocEmail(e.target.value); setErrors(v => ({...v, pocEmail: ''})); }} style={{ borderColor: errors.pocEmail ? 'var(--rose)' : '' }} />
                {errors.pocEmail && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.pocEmail}</div>}
              </div>
              <div className="field">
                <label>Special Delivery Instructions <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(optional)</span></label>
                <textarea value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} placeholder="Gate codes, dock hours, parking instructions, etc." />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingPoc(false)}>Done</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 16 }}>The person who will be on-site to receive the delivery.</p>
              <div className="grid g2" style={{ marginBottom: pocEmail || specialInstructions ? 12 : 0 }}>
                <ReadField label="Full Name" value={pocName || '—'} />
                <ReadField label="Direct Phone" value={pocPhone ? `${pocPhone}${phoneCanText ? ' (can text)' : ''}` : '—'} />
              </div>
              {pocEmail && <ReadField label="Email" value={pocEmail} />}
              {specialInstructions && <ReadField label="Special Delivery Instructions" value={specialInstructions} />}
            </>
          )}
        </div>

        {/* Communication preferences — multi-select */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Communication Preferences</h3></div>
          <div className="field">
            <label>Preferred Communication Method <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(select all that apply)</span></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              {['Phone Call', 'Text Message', 'Email'].map(v => (
                <button key={v} type="button"
                  className={`chip${commMethods.includes(v) ? ' on' : ''}`}
                  onClick={() => toggleCommMethod(v)}>
                  {v === 'Phone Call' ? '📞' : v === 'Text Message' ? '💬' : '📧'} {v}
                </button>
              ))}
            </div>
          </div>
          {commMethods.includes('Text Message') && (
            <div className="field">
              <label>Mobile Number for Text Messages</label>
              <input type="tel" value={mobilePhone} onChange={e => setMobilePhone(e.target.value)} placeholder="+1 303 555 0100" />
              <div className="hint">Standard message and data rates may apply.</div>
            </div>
          )}
        </div>

        {/* Delivery Logistics */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Delivery Logistics</h3>
            {!editingLogistics && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingLogistics(true)}>Edit</button>
            )}
          </div>
          {editingLogistics ? (
            <>
              <div className="alert warn" style={{ marginBottom: 16 }}>
                <span>⚠️</span>
                <span>Changes to delivery logistics may increase your overall freight costs and could delay your delivery depending on various factors. Changes also require confirmation from the Summit team before taking effect — we'll follow up within 1 business day.</span>
              </div>
              <div className="field">
                <label>Delivery Address <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(update if changed)</span></label>
                <input type="text" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Preferred Delivery Window <strong>(weekdays only)</strong></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 14, fontSize: 13.5, cursor: 'pointer', fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={windowAsap}
                    onChange={e => {
                      setWindowAsap(e.target.checked);
                      if (e.target.checked) {
                        setWindowStart('');
                        setWindowEnd('');
                        setErrors(v => ({...v, windowStart: '', windowEnd: ''}));
                      }
                    }}
                    style={{ width: 'auto' }}
                  />
                  Deliver as early as possible
                </label>
                {!windowAsap && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                        <span style={{ color: 'var(--rose)' }}>*</span> Earliest Acceptable Date
                      </label>
                      <input type="date" value={windowStart} min={today}
                        onChange={e => { setWindowStart(e.target.value); setErrors(v => ({...v, windowStart: ''})); }}
                        style={{ borderColor: errors.windowStart ? 'var(--rose)' : '', maxWidth: 220 }} />
                      {errors.windowStart && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowStart}</div>}
                    </div>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                        <span style={{ color: 'var(--rose)' }}>*</span> Latest Acceptable Date
                      </label>
                      <input type="date" value={windowEnd} min={windowStart || today}
                        onChange={e => { setWindowEnd(e.target.value); setErrors(v => ({...v, windowEnd: ''})); }}
                        style={{ borderColor: errors.windowEnd ? 'var(--rose)' : '', maxWidth: 220 }} />
                      {errors.windowEnd && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowEnd}</div>}
                    </div>
                    <div className="hint">Deliveries are made Monday–Friday. Weekend dates will not be accepted.</div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingLogistics(false)}>Done</button>
              </div>
            </>
          ) : (
            <>
              <ReadField label="Delivery Address" value={deliveryAddress || '—'} />
              <ReadField label="Preferred Delivery Window" value={
                windowAsap ? 'As early as possible' :
                (windowStart || windowEnd) ? `${windowStart || 'TBD'} to ${windowEnd || 'TBD'}` : 'Not yet set'
              } />
              {errors.windowStart && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowStart}</div>}
              {errors.windowEnd && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowEnd}</div>}
            </>
          )}
        </div>

        {/* Site Readiness */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>🏗️ Site Readiness</h3></div>
          <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 16 }}>
            Please confirm your site meets the following requirements before your equipment ships. Contact us if any items need attention.
          </p>
          {[
            'Installation room dimensions have been confirmed with Summit Sensory Gym',
            'Flooring installation is complete or will be complete before delivery',
            'Clear pathway from entry to installation room (minimum 36" wide)',
            'Electrical and anchor point requirements have been reviewed',
            'Site contact will be available on the scheduled delivery date',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <span style={{ color: 'var(--ok)', fontWeight: 700, flex: 'none', marginTop: 1 }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
          <div className="alert info" style={{ marginTop: 16 }}>
            <span>ℹ️</span>
            <span>Your order will not ship until site readiness is confirmed. If any items above are not yet complete, note them in the Special Delivery Instructions field above.</span>
          </div>
        </div>

        {/* Freight Acknowledgment */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>🚚 Freight Delivery Acknowledgment</h3></div>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', marginBottom: 20, fontSize: 13.5, lineHeight: 1.65 }}>
            <p style={{ marginBottom: 12 }}>Your order will be shipped via motor freight due to the size and weight of the equipment. Please read the following carefully and share this information with anyone who will be present at the time of delivery.</p>
            <p style={{ fontWeight: 700, marginBottom: 6 }}>How your order will arrive</p>
            <p style={{ marginBottom: 12 }}>Your equipment will be delivered on a pallet (skid) by a freight carrier. The driver is authorized to assist with unloading but cannot be expected to unload the shipment independently, transport items long distances, or bring equipment to a specific room within your facility. Please ensure adequate personnel are on-site and ready to assist at the time of delivery.</p>
            <p style={{ fontWeight: 700, marginBottom: 6 }}>Upon arrival</p>
            <p style={{ marginBottom: 12 }}>All equipment must be brought indoors immediately after delivery. Do not leave pallets or boxes outside or in an unprotected area.</p>
            <p style={{ fontWeight: 700, marginBottom: 6 }}>Inspecting your delivery — important</p>
            <p style={{ marginBottom: 12 }}>Before signing the driver's bill of lading, carefully inspect all items for visible damage. If damage is found, you must note it on the bill of lading at the time of delivery — this is required to file a freight damage claim. Summit Sensory Gym cannot process damage claims for items signed as received in good condition.</p>
            <p style={{ fontWeight: 700, marginBottom: 6 }}>Scheduling and missed appointments</p>
            <p style={{ marginBottom: 12 }}>The freight carrier will contact you to schedule a delivery window. If no one is available during the agreed-upon window, a redelivery fee will apply.</p>
            <p style={{ fontWeight: 700, marginBottom: 6 }}>Storage fees</p>
            <p style={{ marginBottom: 0 }}>If delivery cannot be completed, the freight carrier will hold your shipment for up to 2 business days at no charge. Storage fees beyond that window are the responsibility of the receiving party.</p>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 13.5, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={ackRead} onChange={e => { setAckRead(e.target.checked); setErrors(v => ({...v, ackRead: ''})); }} style={{ width: 'auto', marginTop: 3 }} />
            <span><span style={{ color: 'var(--rose)' }}>*</span> I have read and understand the freight delivery requirements above, and I will share this information with all personnel involved in receiving this shipment.</span>
          </label>
          {errors.ackRead && <div style={{ color: 'var(--rose)', fontSize: 12, marginBottom: 12 }}>{errors.ackRead}</div>}
          <div className="field">
            <label><span style={{ color: 'var(--rose)' }}>*</span> Your Full Name (Acknowledgment Signature)</label>
            <input type="text" value={ackName} onChange={e => { setAckName(e.target.value); setErrors(v => ({...v, ackName: ''})); }}
              placeholder="Type your full name"
              style={{ borderColor: errors.ackName ? 'var(--rose)' : '' }} />
            {errors.ackName && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.ackName}</div>}
          </div>
        </div>

        <TabNav onBack={onBack} nextLabel={saving ? 'Saving…' : 'Save & Continue'} saving={saving} />
      </form>
    </>
  );
}

// ── Tab: Color & Product Selections ──────────────────────────────────────────

function ColorTab({ order, completions, markComplete, showToast, colorForms, onNext, onBack }) {
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [frameHeight, setFrameHeight] = useState(800);
  const formId = order.colorFormId?.trim();
  const embedUrl = formId ? `https://form.jotform.com/${formId}?orderId=${encodeURIComponent(order.id)}&orderName=${encodeURIComponent(order.name)}` : null;

  // Listen for Jotform postMessages — auto-resize height and detect submission
  useEffect(() => {
    if (!embedUrl) return;
    function onMessage(e) {
      // Height auto-resize
      if (typeof e.data === 'string') {
        try {
          const d = JSON.parse(e.data);
          if (d?.action === 'setHeight' && d.height) setFrameHeight(Number(d.height) + 32);
          if (d?.action === 'submission-completed') setFormSubmitted(true);
        } catch {}
        if (e.data.includes('formSubmitted')) setFormSubmitted(true);
      }
      if (typeof e.data === 'object' && e.data) {
        if (e.data.action === 'setHeight' && e.data.height) setFrameHeight(Number(e.data.height) + 32);
        if (e.data.action === 'submission-completed') setFormSubmitted(true);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedUrl]);

  return (
    <>
      <div className="ph">
        <h2>Color & Product Selections</h2>
        <p>Complete your color selection form to finalize your equipment configuration.</p>
      </div>
      {completions.color && <div className="alert success" style={{ marginBottom: 16 }}>✅ Color selections submitted.</div>}
      {formSubmitted && <div className="alert success" style={{ marginBottom: 16 }}>✅ Form submitted! Click &quot;Mark as Complete&quot; below to continue.</div>}

      {embedUrl ? (
        /* Seamless embed — no card border, no padding, form flows as part of the page */
        <iframe
          src={embedUrl}
          title="Color Selection Form"
          scrolling="no"
          style={{
            width: '100%',
            height: frameHeight,
            border: 'none',
            display: 'block',
            background: 'transparent',
            marginBottom: 16,
          }}
          allow="geolocation; camera"
        />
      ) : colorForms.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="ei">🎨</div>
            <h3>Color form not yet assigned</h3>
            <p>Your color selection form hasn't been assigned yet. Our team will update this as your order progresses — you'll receive a notification when it's ready.</p>
          </div>
        </div>
      ) : (
        colorForms.map(([id, form]) => (
          <div key={id} className="card" style={{ marginBottom: 16 }}>
            <div className="ch"><h3>{form.name}</h3></div>
            <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>
              {form.description || 'Select your equipment colors and finish options.'}
              {' '}Your selections will be reviewed by our team before manufacturing begins.
            </p>
            <a
              href={`https://form.jotform.com/${id}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-moss"
              style={{ display: 'inline-flex', marginBottom: 16 }}
            >
              Open Color Selection Form →
            </a>
            <div className="alert info">
              <span>ℹ️</span>
              <span>After submitting the form, click "Mark as Complete" below. Our team will confirm your selections and follow up if any clarification is needed.</span>
            </div>
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <button
          className="btn btn-moss"
          onClick={() => { markComplete('color'); showToast('Color selections marked complete.'); onNext(); }}
        >
          Mark as Complete & Continue →
        </button>
      </div>
    </>
  );
}

// ── Tab: Required Documents ───────────────────────────────────────────────────

function DocumentsTab({ order, completions, markComplete, showToast, docForms, onNext, onBack }) {
  return (
    <>
      <div className="ph"><h2>Required Documents</h2><p>Complete the required forms below before your order can be processed.</p></div>
      {completions.documents && <div className="alert success" style={{ marginBottom: 16 }}>✅ Required documents submitted.</div>}

      {docForms.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="ei">📋</div>
            <h3>No forms required</h3>
            <p>No additional forms are required for your order at this time.</p>
          </div>
        </div>
      ) : (
        docForms.map(([id, form]) => (
          <div key={id} className="card" style={{ marginBottom: 16 }}>
            <div className="ch"><h3>{form.name}</h3></div>
            <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>
              {form.description || 'This form must be completed before your order can ship.'}
            </p>
            <a
              href={`https://form.jotform.com/${id}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-moss"
              style={{ display: 'inline-flex', marginBottom: 16 }}
            >
              Complete Form →
            </a>
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <button
          className="btn btn-moss"
          onClick={() => { markComplete('documents'); showToast('Documents marked complete.'); onNext(); }}
        >
          Mark as Complete & Continue →
        </button>
      </div>
    </>
  );
}

// ── Tab: Dashboard (primary landing screen) ───────────────────────────────────

function DashboardTab({ order, completions, setupComplete, setupCount, setupTotal, onNav }) {
  const firstName = order.firstName || order.pocName?.split(' ')[0] || '';

  return (
    <>
      {/* Welcome header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 6px' }}>
          Welcome{firstName ? `, ${firstName}` : ' back'}! 👋
        </h2>
        <p style={{ color: 'var(--mut)', margin: 0, fontSize: 14.5 }}>
          Here's an overview of your order and what's needed to move it into manufacturing.
        </p>
      </div>

      {/* Setup progress */}
      {!setupComplete ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch">
            <h3>Account Setup — {setupCount} of {setupTotal} Steps Complete</h3>
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
            To move your order into production as quickly as possible, we kindly ask that you complete each step below at your earliest convenience. These steps confirm the details needed to manufacture and deliver your order without delay.
          </p>
          <div className="prog" style={{ marginBottom: 20 }}>
            <i style={{ width: `${Math.round((setupCount / setupTotal) * 100)}%` }} />
          </div>
          {SETUP_TABS.map(tab => (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid var(--line)' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flex: 'none',
                background: completions[tab.id] ? 'var(--ok)' : 'var(--sun-lt)',
                color: completions[tab.id] ? '#fff' : 'var(--sun)',
              }}>
                {completions[tab.id] ? '✓' : '!'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{tab.label}</div>
                <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>
                  {completions[tab.id] ? 'Complete' : 'Action required'}
                </div>
              </div>
              {!completions[tab.id] && (
                <button className="btn btn-moss btn-sm" onClick={() => onNav(tab.id)}>Complete →</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="alert success" style={{ marginBottom: 20 }}>
          <span>🎉</span>
          <strong>All setup steps complete — thank you! Your information has been received by the Summit Sensory Gym team.</strong>
        </div>
      )}

      {/* Order snapshot */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Your Order</h3></div>
        <div className="grid g2">
          <ReadField label="Order Name" value={order.name} />
          <ReadField label="Product" value={order.productType || '—'} />
          <ReadField label="Current Status" value={order.status || '—'} />
          <ReadField label="Projected Ship Date" value={order.shipDate || 'TBD'} />
          {order.address && <ReadField label="Delivery Address" value={order.address} />}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-moss" onClick={() => onNav('status')}>📦 Order Status →</button>
        <button className="btn btn-ghost" onClick={() => onNav('messages')}>💬 Message Our Team</button>
        <button className="btn btn-ghost" onClick={() => onNav('installation')}>🔧 Installation Docs</button>
      </div>
    </>
  );
}

// ── Tab: Order Status & Tracking ──────────────────────────────────────────────

function getCarrierInfo(tracking) {
  const clean = (tracking || '').trim().replace(/\s/g, '');
  if (/^1Z/i.test(clean)) return { name: 'UPS', url: `https://www.ups.com/track?tracknum=${clean}` };
  if (/^(94|92|93|95)\d{18}/.test(clean)) return { name: 'USPS', url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${clean}` };
  return { name: 'FedEx', url: `https://www.fedex.com/fedextrack/?trknbr=${clean}` };
}

function TrackingRow({ tracking, expanded, trackingInfo, loading, onToggle }) {
  const { name: carrierName, url: trackUrl } = getCarrierInfo(tracking);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <code style={{ background: 'var(--paper)', padding: '4px 10px', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', letterSpacing: '.02em', border: '1px solid var(--line)' }}>
          {tracking}
        </code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} style={{ fontSize: 12 }}>
          {expanded ? 'Hide Details ▲' : 'View Details ▼'}
        </button>
        <a href={trackUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
          Track on {carrierName} →
        </a>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, background: 'var(--paper)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--line)' }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--mut)' }}>Loading tracking details…</div>
          ) : trackingInfo ? (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{trackingInfo.status}</div>
                </div>
                {trackingInfo.estimatedDelivery && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Est. Delivery</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{new Date(trackingInfo.estimatedDelivery).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
              {trackingInfo.events?.slice(0, 5).map((ev, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: i < Math.min((trackingInfo.events?.length || 0), 5) - 1 ? '1px solid var(--line)' : 'none', fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{ev.description}</div>
                  {ev.location && <div style={{ color: 'var(--mut)', fontSize: 12 }}>{ev.location}</div>}
                  {ev.timestamp && <div style={{ color: 'var(--mut)', fontSize: 11.5, marginTop: 1 }}>{new Date(ev.timestamp).toLocaleString()}</div>}
                </div>
              ))}
              {trackingInfo.url && (
                <a href={trackingInfo.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--moss)', fontWeight: 600 }}>
                  View full tracking on {carrierName} →
                </a>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--mut)' }}>
              Tracking details not available. <a href={trackUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--moss)' }}>View on {carrierName} →</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ title, carrierLabel, trackingNumbers, shipped, notIncluded, expandedTracking, trackingData, loadingTracking, onToggleTracking, note, carrierPhone, carrierPhoneLabel }) {
  if (notIncluded) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3>{title}</h3>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, letterSpacing: '.04em',
          background: shipped ? 'var(--ok-lt)' : 'var(--line)',
          color: shipped ? 'var(--ok)' : 'var(--mut)',
        }}>
          {shipped ? '✓ SHIPPED' : 'NOT YET SHIPPED'}
        </span>
      </div>
      {carrierLabel && <div style={{ fontSize: 13, color: 'var(--mut)', marginBottom: shipped ? 12 : 0 }}>Carrier: {carrierLabel}</div>}
      {shipped && trackingNumbers.length > 0 ? (
        <>
          {trackingNumbers.map(t => (
            <TrackingRow
              key={t}
              tracking={t}
              expanded={expandedTracking[t]}
              trackingInfo={trackingData[t]}
              loading={loadingTracking[t]}
              onToggle={() => onToggleTracking(t)}
            />
          ))}
          {carrierPhone && (
            <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 8 }}>
              {carrierPhoneLabel || 'Carrier'}:{' '}
              <a href={`tel:${carrierPhone.replace(/\D/g, '')}`} style={{ color: 'var(--moss)', fontWeight: 600 }}>{carrierPhone}</a>
            </div>
          )}
        </>
      ) : !shipped ? (
        <div style={{ fontSize: 13.5, color: 'var(--mut)', fontStyle: 'italic', marginTop: 4 }}>
          Tracking information will appear here once this shipment has been dispatched.
        </div>
      ) : null}
      {note && (
        <div className="alert info" style={{ marginTop: 14 }}>
          <span>ℹ️</span>
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

function StatusTab({ order }) {
  const [expandedTracking, setExpandedTracking] = useState({});
  const [trackingData, setTrackingData] = useState({});
  const [loadingTracking, setLoadingTracking] = useState({});

  async function loadTracking(trackingNumber) {
    if (trackingData[trackingNumber] || loadingTracking[trackingNumber]) return;
    setLoadingTracking(prev => ({ ...prev, [trackingNumber]: true }));
    try {
      const res = await fetch(`/api/fedex/track?number=${encodeURIComponent(trackingNumber)}`);
      if (res.ok) {
        const data = await res.json();
        setTrackingData(prev => ({ ...prev, [trackingNumber]: data.tracking }));
      }
    } catch {}
    finally { setLoadingTracking(prev => ({ ...prev, [trackingNumber]: false })); }
  }

  function toggleTracking(t) {
    const nowExpanded = !expandedTracking[t];
    setExpandedTracking(prev => ({ ...prev, [t]: nowExpanded }));
    if (nowExpanded) loadTracking(t);
  }

  const stages = order.stages || [];
  const shippedIdx = stages.findIndex(s => s.key === 'shipped');
  const deliveredIdx = stages.findIndex(s => s.key === 'delivered');
  const isShipped = order.stageIndex >= shippedIdx && shippedIdx >= 0;
  const isDelivered = order.stageIndex >= deliveredIdx && deliveredIdx >= 0;

  // Parse tracking numbers
  const frameTrackings = order.trackingNumber ? [order.trackingNumber] : [];
  const matTrackings = order.matTracking
    ? order.matTracking.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  // Parse other shipments: "Label|Carrier|Tracking" per line
  const otherShipments = order.otherShipments
    ? order.otherShipments.split('\n').map(line => {
        const parts = line.split('|');
        return { label: parts[0]?.trim(), carrier: parts[1]?.trim(), tracking: parts[2]?.trim() };
      }).filter(s => s.label && s.tracking)
    : [];

  const sharedProps = { expandedTracking, trackingData, loadingTracking, onToggleTracking: toggleTracking };

  return (
    <>
      <div className="ph"><h2>Order Status & Tracking</h2><p>Track all shipments for your order.</p></div>

      {/* Current stage card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: 'none',
            background: isDelivered ? 'var(--ok-lt)' : isShipped ? '#EFF6FF' : 'var(--moss-lt)',
          }}>
            {isDelivered ? '✅' : isShipped ? '🚚' : '🔧'}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 3 }}>Current Stage</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{order.status || 'In Progress'}</div>
            {order.shipDate && !isShipped && (
              <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 2 }}>Projected Ship Date: {order.shipDate}</div>
            )}
            {order.shipDate && isShipped && (
              <div style={{ fontSize: 13, color: 'var(--ok)', marginTop: 2, fontWeight: 600 }}>Shipped: {order.shipDate}</div>
            )}
          </div>
        </div>

        {/* Stage timeline */}
        <div className="tl" style={{ marginTop: 16 }}>
          {stages.map((stage, i) => {
            const isDone = i < order.stageIndex;
            const isCur = i === order.stageIndex;
            return (
              <div key={stage.key} className={`step${isDone ? ' done' : ''}${isCur ? ' cur' : ''}`}>
                <div className="sd">{isDone ? '✓' : isCur ? '●' : i + 1}</div>
                <div className="sb">
                  <div className="t">{stage.icon} {stage.label}</div>
                  {isCur && <div className="d" style={{ color: 'var(--moss)' }}>Current stage</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Frame shipment */}
      <ShipmentCard
        title="Sensory Gym Frame"
        carrierLabel="FedEx Freight"
        trackingNumbers={frameTrackings}
        shipped={frameTrackings.length > 0}
        note="Your frame arrives on a freight pallet. Please have personnel on-site to assist with unloading and moving components into your facility."
        carrierPhone="1-866-393-4585"
        carrierPhoneLabel="FedEx Freight Customer Service"
        {...sharedProps}
      />

      {/* Mats & Padding */}
      <ShipmentCard
        title="Therapy Mats & Padding"
        carrierLabel={matTrackings.length > 0 ? 'Standard Carrier' : null}
        trackingNumbers={matTrackings}
        shipped={matTrackings.length > 0}
        notIncluded={order.matTracking === 'N/A'}
        note="Mats and padding ship separately and may arrive on a different day than your frame."
        {...sharedProps}
      />

      {/* Other / additional items */}
      {otherShipments.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Additional Order Items</h3></div>
          {otherShipments.map((shipment, i) => (
            <div key={i} style={{ borderBottom: i < otherShipments.length - 1 ? '1px solid var(--line)' : 'none', paddingBottom: i < otherShipments.length - 1 ? 14 : 0, marginBottom: i < otherShipments.length - 1 ? 14 : 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{shipment.label}</div>
              <TrackingRow
                tracking={shipment.tracking}
                expanded={expandedTracking[shipment.tracking]}
                trackingInfo={trackingData[shipment.tracking]}
                loading={loadingTracking[shipment.tracking]}
                onToggle={() => toggleTracking(shipment.tracking)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Delivery info */}
      {order.address && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>📍 Delivery Information</h3></div>
          <div className="grid g2">
            <ReadField label="Delivery Address" value={order.address} />
            {order.productType && <ReadField label="Product" value={order.productType} />}
          </div>
          <div className="alert info" style={{ marginTop: 12 }}>
            <span>📞</span>
            <span>Your freight carrier will contact you to schedule a delivery window. If you haven't heard from them within a week of your ship date, call FedEx Freight at <strong>1-866-393-4585</strong> with your tracking number.</span>
          </div>
        </div>
      )}

      {/* Questions */}
      <div style={{ fontSize: 13.5, color: 'var(--mut)', marginTop: 4 }}>
        Questions about your shipment?{' '}
        <a href="mailto:orders@summitsensory.com" style={{ color: 'var(--moss)', fontWeight: 600 }}>orders@summitsensory.com</a>
      </div>
    </>
  );
}

// ── Tab: Installation ─────────────────────────────────────────────────────────

function InstallationTab({ order, onNav }) {
  function getEmbedUrl(url) {
    const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return null;
  }

  const videos = order.installationVideos
    ? order.installationVideos.split(',').map(u => u.trim()).filter(Boolean)
    : [];

  const docs = order.installationDocs
    ? order.installationDocs.split(',').map(entry => {
        const parts = entry.trim().split('|');
        return parts.length >= 2
          ? { label: parts[0].trim(), url: parts[1].trim() }
          : { label: 'Installation Document', url: parts[0].trim() };
      }).filter(d => d.url)
    : [];

  const links = order.installationLinks
    ? order.installationLinks.split('\n').map(line => {
        const parts = line.trim().split('|');
        return parts.length >= 2
          ? { label: parts[0].trim(), url: parts[1].trim() }
          : { label: 'Installation Resource', url: parts[0].trim() };
      }).filter(l => l.url)
    : [];

  const hasContent = videos.length > 0 || docs.length > 0 || links.length > 0;

  function docIcon(url) {
    const u = url.toLowerCase();
    if (u.includes('.pdf')) return '📕';
    if (u.includes('.doc')) return '📝';
    return '📄';
  }

  return (
    <>
      <div className="ph">
        <h2>Installation</h2>
        <p>Everything you need to successfully install your Summit Sensory Gym.</p>
      </div>

      {/* Print recommendation */}
      <div style={{ display: 'flex', gap: 14, background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
        <span style={{ fontSize: 20, flex: 'none' }}>🖨️</span>
        <div>
          <div style={{ fontWeight: 700, color: '#713F12', marginBottom: 4 }}>We recommend printing your installation documents before your delivery date.</div>
          <div style={{ fontSize: 13, color: '#92400E' }}>Having printed instructions on hand makes the installation process significantly smoother — you won't need to reference a screen while assembling your equipment.</div>
        </div>
      </div>

      {!hasContent ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="empty">
            <div className="ei">🔧</div>
            <h3>Installation materials coming soon</h3>
            <p>Your installation videos and documents are being prepared and will appear here before your delivery date. You'll receive an email notification as soon as they're available.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Installation Material Links */}
          {links.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="ch"><h3>🔗 Installation Materials</h3></div>
              <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
                Click any link below to open the installation material in a new tab.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {links.map((link, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--paper)', borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{link.label}</div>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${link.label}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--moss)', color: '#fff', textDecoration: 'none', fontSize: 16, flex: 'none', transition: 'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Videos */}
          {videos.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="ch"><h3>🎬 Installation Videos</h3></div>
              <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
                Watch these before your delivery to familiarize yourself with the installation process.
              </p>
              {videos.map((url, i) => {
                const embedUrl = getEmbedUrl(url);
                return embedUrl ? (
                  <div key={i} style={{ marginBottom: i < videos.length - 1 ? 20 : 0 }}>
                    <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                      <iframe
                        src={embedUrl}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={`Installation Video ${i + 1}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost">▶ View Video →</a>
                  </div>
                );
              })}
            </div>
          )}

          {/* Documents */}
          {docs.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="ch"><h3>📋 Installation Documents</h3></div>
              <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
                Download and print these documents prior to your delivery. Some drawings may show optional accessories not included in your order — additional components can be added at any time.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {docs.map((doc, i) => (
                  <a key={i} href={doc.url} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--paper)', borderRadius: 10, border: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)', transition: '.15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--moss)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--moss-lt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: 'none' }}>
                      {docIcon(doc.url)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>Click to download or view</div>
                    </div>
                    <div style={{ color: 'var(--moss)', fontSize: 13, fontWeight: 600 }}>↓</div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Important notes */}
      <div className="card">
        <div className="ch"><h3>Important Notes</h3></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { icon: '📦', text: 'Your frame arrives on a freight pallet. Please ensure you have adequate personnel available to assist with unloading and moving components into your facility.' },
            { icon: '🏗️', text: 'Crate contents will need to be hand-unloaded and brought through building doors individually — the assembled crate is typically too large to fit through a standard doorway.' },
            { icon: '❓', text: null },
          ].map((item, i, arr) => item.text ? (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 13.5 }}>
              <span style={{ flex: 'none', marginTop: 1 }}>{item.icon}</span>
              <span style={{ color: 'var(--ink)', lineHeight: 1.55 }}>{item.text}</span>
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', fontSize: 13.5 }}>
              <span style={{ flex: 'none', marginTop: 1 }}>❓</span>
              <span style={{ color: 'var(--ink)', lineHeight: 1.55 }}>
                Questions about installation?{' '}
                <button type="button" onClick={() => onNav('messages')} style={{ background: 'none', border: 'none', color: 'var(--moss)', fontWeight: 600, cursor: 'pointer', fontSize: 13.5, padding: 0 }}>
                  Message our team
                </button>
                {' '}or email{' '}
                <a href="mailto:orders@summitsensory.com" style={{ color: 'var(--moss)' }}>orders@summitsensory.com</a>.
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Tab: Files ────────────────────────────────────────────────────────────────

function FilesTab({ files }) {
  function fileIcon(ext = '') {
    const e = ext.toLowerCase();
    if (['jpg','jpeg','png','gif','webp'].includes(e)) return '🖼️';
    if (e === 'pdf') return '📕';
    if (['doc','docx'].includes(e)) return '📝';
    return '📄';
  }
  function fileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return (
    <>
      <div className="ph"><h2>Files & Documents</h2><p>Your signed proposal, design rendering images, and any other documents shared by the Summit Sensory Gym team.</p></div>
      <div className="card">
        {files.length === 0 ? (
          <div className="empty"><div className="ei">📁</div><h3>No files yet</h3><p>Your signed proposal, design renderings, and other shared documents will appear here once they're available.</p></div>
        ) : files.map(file => (
          <div key={file.id} className="file">
            <div className="f-ic" style={{ background: 'var(--sky-lt)', color: 'var(--sky)' }}>{fileIcon(file.file_extension)}</div>
            <div className="f-b">
              <div className="t">{file.name}</div>
              <div className="d">{file.file_extension?.toUpperCase()}{file.file_size && ` · ${fileSize(file.file_size)}`}{file.created_at && ` · ${new Date(file.created_at).toLocaleDateString()}`}</div>
            </div>
            <a href={file.public_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Download</a>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Tab: Invoice & Payment ────────────────────────────────────────────────────

function InvoiceTab({ order }) {
  return (
    <>
      <div className="ph"><h2>Invoice & Payment</h2><p>View your current invoice and submit payment securely.</p></div>

      {/* Payment terms */}
      <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--sun)' }}>
        <div className="ch"><h3>Payment Terms</h3></div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 12 }}>
          <strong>Your order cannot ship until the account balance is paid in full.</strong> If you have a pre-approved purchase order on file, please ensure it covers the full balance and has been submitted to our orders team prior to your scheduled ship date.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 12, color: 'var(--mut)' }}>
          <strong>Late Payment Policy:</strong> Invoices not paid in full prior to the scheduled ship date are subject to a late payment fee of <strong>1.5% per month (18% annually)</strong> on the outstanding balance. Late fees begin accruing on the first business day following the ship date if payment has not been received. Summit Sensory Gym reserves the right to delay shipment until the account balance is cleared.
        </p>
        <p style={{ fontSize: 13, color: 'var(--mut)', margin: 0 }}>
          Questions about your invoice? <a href="mailto:orders@summitsensory.com" style={{ color: 'var(--moss)' }}>orders@summitsensory.com</a>
        </p>
      </div>

      {order.invoiceLink ? (
        <>
          {/* Embedded invoice */}
          <div className="card pad0" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ fontSize: 16, margin: 0 }}>Your Invoice</h3>
              <a href={order.invoiceLink} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                Open in New Tab →
              </a>
            </div>
            <iframe
              src={order.invoiceLink}
              title="Invoice"
              style={{ width: '100%', height: 700, border: 'none', display: 'block' }}
              allow="fullscreen"
            />
          </div>

          {/* Payment button */}
          {order.paymentLink && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 24px' }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>💳</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>Ready to Pay?</h3>
              <p style={{ color: 'var(--mut)', fontSize: 14, marginBottom: 20 }}>
                Click below to securely submit your payment. Your order will be released to ship once payment is confirmed.
              </p>
              <a href={order.paymentLink} target="_blank" rel="noreferrer" className="btn btn-moss" style={{ display: 'inline-flex', fontSize: 15, padding: '12px 28px' }}>
                Submit Payment →
              </a>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <div className="empty">
            <div className="ei">💰</div>
            <h3>Invoice not yet available</h3>
            <p>Your invoice will appear here once it has been generated. Contact us at <a href="mailto:orders@summitsensory.com" style={{ color: 'var(--moss)' }}>orders@summitsensory.com</a> with questions.</p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Tab: Messages ─────────────────────────────────────────────────────────────

function MessagesTab({ order, messages, onRefresh, showToast }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/monday/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, body }),
      });
      if (!res.ok) throw new Error();
      setBody('');
      await onRefresh();
      showToast('Message sent.');
    } catch { showToast('Failed to send. Please try again.'); }
    finally { setSending(false); }
  }

  function isStaff(email) {
    return email?.includes('summitsensory') || email?.includes('summitsensorygym');
  }

  // Only show messages sent through the portal (tagged [PORTAL])
  const portalMessages = messages.filter(m => m.body?.startsWith('[PORTAL]'));

  function stripTag(body) {
    return (body || '').replace(/^\[PORTAL\]\n?/, '');
  }

  return (
    <>
      <div className="ph"><h2>Messages</h2><p>Direct communication with the Summit Sensory Gym team.</p></div>
      <div className="card pad0">
        <div className="chat">
          <div className="chat-h">Order: {order.name}</div>
          <div className="chat-b">
            {portalMessages.length === 0 && (
              <div className="empty" style={{ padding: '30px 0' }}>
                <div className="ei">💬</div>
                <h3>No messages yet</h3>
                <p>Send a message below and our team will respond here.</p>
              </div>
            )}
            {portalMessages.map(msg => {
              const staff = isStaff(msg.creator?.email);
              return (
                <Fragment key={msg.id}>
                  <div className={`bub ${staff ? 'them' : 'me'}`}>
                    {staff && msg.creator && (
                      <div style={{ fontSize: 11, opacity: .7, marginBottom: 3 }}>{msg.creator.name}</div>
                    )}
                    <div dangerouslySetInnerHTML={{ __html: stripTag(msg.body) }} />
                    <div className="ts">{new Date(msg.created_at).toLocaleString()}</div>
                  </div>
                  {(msg.replies || []).map(reply => {
                    const replyStaff = isStaff(reply.creator?.email);
                    return (
                      <div key={reply.id} className={`bub ${replyStaff ? 'them' : 'me'}`}>
                        {replyStaff && reply.creator && (
                          <div style={{ fontSize: 11, opacity: .7, marginBottom: 3 }}>{reply.creator.name}</div>
                        )}
                        <div dangerouslySetInnerHTML={{ __html: reply.body }} />
                        <div className="ts">{new Date(reply.created_at).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
          <form className="chat-i" onSubmit={send}>
            <input type="text" placeholder="Type a message…" value={body} onChange={e => setBody(e.target.value)} disabled={sending} />
            <button className="btn btn-moss btn-sm" disabled={sending || !body.trim()}>{sending ? '…' : 'Send'}</button>
          </form>
        </div>
      </div>
    </>
  );
}

// ── Tab: Contact Us ───────────────────────────────────────────────────────────

function ContactUsTab({ onNav }) {
  return (
    <>
      <div className="ph">
        <h2>Contact Us</h2>
        <p>We're here to help with any questions about your order, delivery, or installation.</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Summit Sensory Gym</h3></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              icon: '📍',
              label: 'Mailing Address',
              content: <span style={{ color: 'var(--mut)', lineHeight: 1.6 }}>6150 S Geneva Court<br />Englewood, CO 80111</span>,
            },
            {
              icon: '📧',
              label: 'Email',
              content: (
                <>
                  <a href="mailto:orders@summitsensory.com" style={{ color: 'var(--moss)', fontWeight: 600 }}>orders@summitsensory.com</a>
                  <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>Opens your default email application</div>
                </>
              ),
            },
            {
              icon: '📞',
              label: 'Phone',
              content: (
                <>
                  <a href="tel:+17204575500" style={{ color: 'var(--moss)', fontWeight: 600 }}>+1 (720) 457-5500</a>
                  <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>Compatible with Microsoft Teams and other calling apps</div>
                </>
              ),
            },
          ].map((item, i, arr) => (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--moss-lt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flex: 'none' }}>
                {item.icon}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--mut)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.label}</div>
                <div style={{ fontSize: 14 }}>{item.content}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="ch"><h3>Send a Message</h3></div>
        <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16 }}>
          For order-specific questions, the <strong>Messages tab</strong> connects you directly with our team through the portal. Your message will be linked to your order and routed to the right person — typically the fastest way to get a response.
        </p>
        <button className="btn btn-moss" onClick={() => onNav('messages')}>
          Go to Messages →
        </button>
      </div>
    </>
  );
}

// ── Order Picker ──────────────────────────────────────────────────────────────

function OrderPicker({ orders, onSelect }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper)', padding: 24 }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--moss)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 700, marginBottom: 16 }}>S</div>
          <h2 style={{ fontSize: 24, marginBottom: 6 }}>Select Your Order</h2>
          <p style={{ color: 'var(--mut)', fontSize: 14 }}>We found multiple orders linked to your email. Which order would you like to access?</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orders.map(o => (
            <button key={o.id} onClick={() => onSelect(o)}
              style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 20px', textAlign: 'left', cursor: 'pointer', transition: '.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--moss)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
            >
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{o.name}</div>
              <div style={{ fontSize: 13, color: 'var(--mut)' }}>
                {o.productType && <span style={{ marginRight: 12 }}>📦 {o.productType}</span>}
                {o.status && <span>Status: {o.status}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared UI components ──────────────────────────────────────────────────────

function ReadField({ label, value }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mut)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value || '—'}</div>
    </div>
  );
}

function TabNav({ onBack, onNext, nextLabel = 'Save & Continue', saving = false }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
      {onBack && <button type="button" className="btn btn-ghost" onClick={onBack}>← Back</button>}
      <button type={onNext ? 'button' : 'submit'} className="btn btn-moss" onClick={onNext} disabled={saving}>
        {nextLabel} {!saving && '→'}
      </button>
    </div>
  );
}
