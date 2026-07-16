/**
 * Customer Portal
 * Two navigation groups:
 *   ACCOUNT SETUP  — 5 sequential tabs customers complete once
 *   MY ORDER       — ongoing access to dashboard, status, files, messages, etc.
 */

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

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
  { id: 'referral',     label: 'Refer a Friend',     icon: '🎁', reward: true },
  { id: 'showcase',     label: 'Photo & Video Showcase', icon: '📸', reward: true },
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

              {ORDER_TABS.map((tab, i) => (
                <Fragment key={tab.id}>
                  {tab.reward && !ORDER_TABS[i - 1]?.reward && (
                    <div className="lab reward-lab">🌟 Earn Rewards</div>
                  )}
                  <button
                    className={`${activeTab === tab.id ? 'on' : ''}${tab.reward ? ' reward' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className="ni">{tab.icon}</span>
                    {tab.label}
                    {tab.id === 'messages' && unreadMessages > 0 && (
                      <span className="badge">{unreadMessages}</span>
                    )}
                  </button>
                </Fragment>
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
            {activeTab === 'referral'     && <ReferralTab     order={order} showToast={showToast} />}
            {activeTab === 'showcase'     && <ShowcaseTab     order={order} />}
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
            {ORDER_TABS.map((tab, i) => (
              <Fragment key={tab.id}>
                {tab.reward && !ORDER_TABS[i - 1]?.reward && (
                  <div className="lab reward-lab">🌟 Earn Rewards</div>
                )}
                <button
                  className={`${activeTab === tab.id ? 'on' : ''}${tab.reward ? ' reward' : ''}`}
                  onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
                >
                  <span className="ni">{tab.icon}</span>
                  {tab.label}
                  {tab.id === 'messages' && unreadMessages > 0 && (
                    <span className="badge">{unreadMessages}</span>
                  )}
                </button>
              </Fragment>
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
  // Name, Email, and Phone are all required — auto-open editing if Monday is missing any of them
  const [editing, setEditing] = useState(!(order.contactName?.trim() && order.contactPhone?.trim() && order.contactEmail?.trim()));
  const [name, setName] = useState(order.contactName || '');
  const [phone, setPhone] = useState(order.contactPhone || '');
  const [email, setEmail] = useState(order.contactEmail || '');
  const [saving, setSaving] = useState(false);
  const [updateSubmitted, setUpdateSubmitted] = useState(false);
  const [errors, setErrors] = useState({});

  function validate() {
    const e = {};
    if (!name.trim()) e.name = 'Required';
    if (!phone.trim()) e.phone = 'Required';
    if (!email.trim()) e.email = 'Required';
    return e;
  }

  async function submitUpdate(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      showToast('Please complete all required fields.');
      return;
    }
    setErrors({});
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
    if (!order.contactName?.trim() || !order.contactPhone?.trim() || !order.contactEmail?.trim()) {
      setEditing(true);
      showToast('Please complete all required contact fields before continuing.');
      return;
    }
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
                <label><span style={{ color: 'var(--rose)' }}>*</span> Full Name</label>
                <input type="text" value={name} onChange={e => { setName(e.target.value); setErrors(v => ({...v, name: ''})); }} placeholder="Full name" required style={{ borderColor: errors.name ? 'var(--rose)' : '' }} />
                {errors.name && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.name}</div>}
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Email Address</label>
                <input type="email" value={email} onChange={e => { setEmail(e.target.value); setErrors(v => ({...v, email: ''})); }} placeholder="email@example.com" required style={{ borderColor: errors.email ? 'var(--rose)' : '' }} />
                {errors.email && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.email}</div>}
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Phone</label>
                <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setErrors(v => ({...v, phone: ''})); }} placeholder="+1 303 555 0100" required style={{ borderColor: errors.phone ? 'var(--rose)' : '' }} />
                {errors.phone && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.phone}</div>}
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
            <ReadField label="Name *" value={order.contactName || '—'} />
            <ReadField label="Email *" value={order.contactEmail || '—'} />
            <ReadField label="Phone *" value={order.contactPhone || '—'} />
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
  // Bill-to address is pre-filled from Monday.com (Manufacturing Process board) — editable, no toggle
  const [billingAddress, setBillingAddress] = useState(order.billingAddressOnFile || '');
  const [billingAddressSuite, setBillingAddressSuite] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingZip, setBillingZip] = useState(order.billingZipOnFile || '');
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
    if (!streetRef.current || typeof window === 'undefined' || !window.google?.maps?.places) return;
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
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!billingAddress.trim()) {
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
          {(order.billingAddressOnFile || order.billingZipOnFile) && (
            <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 16 }}>Pre-filled from your record on file — update below if anything is incorrect.</p>
          )}
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

  // Secondary delivery point of contact (optional, expands when enabled)
  const [hasSecondaryPoc, setHasSecondaryPoc] = useState(false);
  const [secondaryPocName, setSecondaryPocName] = useState('');
  const [secondaryPocPhone, setSecondaryPocPhone] = useState('');
  const [secondaryPhoneCanText, setSecondaryPhoneCanText] = useState(false);
  const [secondaryPocEmail, setSecondaryPocEmail] = useState('');

  // Ship-to address: confirm what's on file, or expand to enter a new one
  const [addressConfirmed, setAddressConfirmed] = useState(null); // null = unanswered, true = yes, false = no
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressZip, setAddressZip] = useState('');
  const [addressCountry, setAddressCountry] = useState('');

  // Loading dock — required, defaults to "No" (liftgate delivery)
  const [hasLoadingDock, setHasLoadingDock] = useState('no'); // 'yes' | 'no'

  // Delivery timing — ship ASAP, or schedule on/after a preferred date
  const [deliveryTiming, setDeliveryTiming] = useState(''); // 'asap' | 'scheduled'
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState('');

  // Communication preferences — specific to each contact, not shared
  const [primaryCommMethods, setPrimaryCommMethods] = useState(['Email']);
  const [primaryMobilePhone, setPrimaryMobilePhone] = useState('');
  const [secondaryCommMethods, setSecondaryCommMethods] = useState(['Email']);
  const [secondaryMobilePhone, setSecondaryMobilePhone] = useState('');
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

  // Default ship-to address comes from the Billing Information tab's Bill-To Address (Monday-sourced)
  const billingAddressOnFile = order.billingAddressOnFile
    ? `${order.billingAddressOnFile}${order.billingZipOnFile ? ' ' + order.billingZipOnFile : ''}`
    : '';

  function toggleCommMethod(setter, v) {
    setter(prev => prev.includes(v) ? prev.filter(m => m !== v) : [...prev, v]);
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

    if (hasSecondaryPoc) {
      if (!secondaryPocName.trim()) e.secondaryPocName = 'Required';
      if (!secondaryPocPhone.trim()) e.secondaryPocPhone = 'Required';
      if (!secondaryPocEmail.trim()) e.secondaryPocEmail = 'Required';
    }

    if (addressConfirmed === null) e.addressConfirmed = 'Please confirm your ship-to address';
    if (addressConfirmed === false) {
      if (!addressLine1.trim()) e.addressLine1 = 'Required';
      if (!addressCity.trim()) e.addressCity = 'Required';
      if (!addressCountry.trim()) e.addressCountry = 'Required';
    }

    if (!deliveryTiming) e.deliveryTiming = 'Please choose a delivery timing option';
    if (deliveryTiming === 'scheduled') {
      if (!preferredDeliveryDate) e.preferredDeliveryDate = 'Required';
      else if (!isWeekday(preferredDeliveryDate)) e.preferredDeliveryDate = 'Must be a weekday';
    }

    if (!ackRead) e.ackRead = 'Required';
    if (!ackName.trim()) e.ackName = 'Required';
    return e;
  }

  function getChangedRestricted() {
    const changed = [];
    if (addressConfirmed === false) changed.push('Ship-To Address');
    if (deliveryTiming) changed.push('Preferred Delivery Timing');
    if (hasLoadingDock) changed.push('Loading Dock / Liftgate Requirement');
    return changed;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Open the relevant section so errors are visible
      if (errs.pocName || errs.pocPhone || errs.pocEmail || errs.secondaryPocName || errs.secondaryPocPhone || errs.secondaryPocEmail) setEditingPoc(true);
      if (errs.addressConfirmed || errs.addressLine1 || errs.addressCity || errs.addressCountry || errs.deliveryTiming || errs.preferredDeliveryDate) setEditingLogistics(true);
      showToast('Please complete all required fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    const changedRestricted = getChangedRestricted();

    const formattedAddress = addressConfirmed === false
      ? [addressLine1, addressLine2, addressCity, [addressState, addressZip].filter(Boolean).join(' '), addressCountry].filter(Boolean).join(', ')
      : billingAddressOnFile;

    const deliveryTimingLabel = deliveryTiming === 'asap'
      ? 'Ship as soon as my order is ready'
      : `Schedule delivery on or after ${preferredDeliveryDate}`;

    const loadingDockLabel = hasLoadingDock === 'yes'
      ? 'Yes, No need for lift gate delivery'
      : 'No, I need liftgate delivery';

    try {
      await saveSetup('delivery', {
        pocName, pocPhone, phoneCanText, pocEmail, specialInstructions,
        hasSecondaryPoc,
        secondaryPocName: hasSecondaryPoc ? secondaryPocName : '',
        secondaryPocPhone: hasSecondaryPoc ? secondaryPocPhone : '',
        secondaryPhoneCanText: hasSecondaryPoc ? secondaryPhoneCanText : false,
        secondaryPocEmail: hasSecondaryPoc ? secondaryPocEmail : '',
        primaryCommMethods, primaryMobilePhone,
        secondaryCommMethods: hasSecondaryPoc ? secondaryCommMethods : [],
        secondaryMobilePhone: hasSecondaryPoc ? secondaryMobilePhone : '',
        addressConfirmed,
        addressLine1: addressConfirmed === false ? addressLine1 : '',
        addressLine2: addressConfirmed === false ? addressLine2 : '',
        addressCity: addressConfirmed === false ? addressCity : '',
        addressState: addressConfirmed === false ? addressState : '',
        addressZip: addressConfirmed === false ? addressZip : '',
        addressCountry: addressConfirmed === false ? addressCountry : '',
        formattedAddress,
        loadingDock: loadingDockLabel,
        deliveryTiming: deliveryTimingLabel,
        preferredDeliveryDate: deliveryTiming === 'scheduled' ? preferredDeliveryDate : '',
        changedRestricted,
        freightAckBy: ackName,
        freightAckDate: new Date().toISOString().split('T')[0],
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
                <label>Preferred Communication Method <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  {['Phone Call', 'Text Message', 'Email'].map(v => (
                    <button key={v} type="button"
                      className={`chip${primaryCommMethods.includes(v) ? ' on' : ''}`}
                      onClick={() => toggleCommMethod(setPrimaryCommMethods, v)}>
                      {v === 'Phone Call' ? '📞' : v === 'Text Message' ? '💬' : '📧'} {v}
                    </button>
                  ))}
                </div>
              </div>
              {primaryCommMethods.includes('Text Message') && (
                <div className="field">
                  <label>Mobile Number for Text Messages</label>
                  <input type="tel" value={primaryMobilePhone} onChange={e => setPrimaryMobilePhone(e.target.value)} placeholder="+1 303 555 0100" />
                  <div className="hint">Standard message and data rates may apply.</div>
                </div>
              )}
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
              <ReadField label="Preferred Communication" value={`${primaryCommMethods.join(', ') || 'None selected'}${primaryCommMethods.includes('Text Message') && primaryMobilePhone ? ` — Mobile: ${primaryMobilePhone}` : ''}`} />
              {specialInstructions && <ReadField label="Special Delivery Instructions" value={specialInstructions} />}
            </>
          )}
        </div>

        {/* Secondary Delivery POC */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Secondary Delivery Point of Contact</h3></div>
          <label className="sw" style={{ marginBottom: hasSecondaryPoc ? 16 : 0, cursor: 'pointer' }}>
            <div className={`toggle${hasSecondaryPoc ? ' on' : ''}`} onClick={() => setHasSecondaryPoc(v => !v)} />
            <span>Is there a secondary point of contact for the delivery?</span>
          </label>
          {hasSecondaryPoc && (
            <>
              <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 16 }}>An additional person who can be reached about this delivery.</p>
              <div className="row">
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Full Name</label>
                  <input type="text" value={secondaryPocName} onChange={e => { setSecondaryPocName(e.target.value); setErrors(v => ({...v, secondaryPocName: ''})); }} style={{ borderColor: errors.secondaryPocName ? 'var(--rose)' : '' }} />
                  {errors.secondaryPocName && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.secondaryPocName}</div>}
                </div>
                <div className="field">
                  <label><span style={{ color: 'var(--rose)' }}>*</span> Direct Phone</label>
                  <input type="tel" value={secondaryPocPhone} onChange={e => { setSecondaryPocPhone(e.target.value); setErrors(v => ({...v, secondaryPocPhone: ''})); }} placeholder="+1 303 555 0100" style={{ borderColor: errors.secondaryPocPhone ? 'var(--rose)' : '' }} />
                  {errors.secondaryPocPhone && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.secondaryPocPhone}</div>}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, cursor: 'pointer', fontWeight: 400 }}>
                    <input type="checkbox" checked={secondaryPhoneCanText} onChange={e => setSecondaryPhoneCanText(e.target.checked)} style={{ width: 'auto' }} />
                    This number can receive text messages
                  </label>
                </div>
              </div>
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Email</label>
                <input type="email" value={secondaryPocEmail} onChange={e => { setSecondaryPocEmail(e.target.value); setErrors(v => ({...v, secondaryPocEmail: ''})); }} style={{ borderColor: errors.secondaryPocEmail ? 'var(--rose)' : '' }} />
                {errors.secondaryPocEmail && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.secondaryPocEmail}</div>}
              </div>
              <div className="field">
                <label>Preferred Communication Method <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  {['Phone Call', 'Text Message', 'Email'].map(v => (
                    <button key={v} type="button"
                      className={`chip${secondaryCommMethods.includes(v) ? ' on' : ''}`}
                      onClick={() => toggleCommMethod(setSecondaryCommMethods, v)}>
                      {v === 'Phone Call' ? '📞' : v === 'Text Message' ? '💬' : '📧'} {v}
                    </button>
                  ))}
                </div>
              </div>
              {secondaryCommMethods.includes('Text Message') && (
                <div className="field">
                  <label>Mobile Number for Text Messages</label>
                  <input type="tel" value={secondaryMobilePhone} onChange={e => setSecondaryMobilePhone(e.target.value)} placeholder="+1 303 555 0100" />
                  <div className="hint">Standard message and data rates may apply.</div>
                </div>
              )}
            </>
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
          <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 16, lineHeight: 1.55 }}>
            Summit Sensory Gym is committed to ensuring your new sensory therapy gym is delivered as quickly as possible. Please be aware that most gyms require 6 to 8 weeks for manufacturing. We kindly ask that you consider this timeline when providing your ideal delivery date range in the question below.
          </p>
          {editingLogistics ? (
            <>
              <div className="alert warn" style={{ marginBottom: 16 }}>
                <span>⚠️</span>
                <span>Changes to delivery logistics may increase your overall freight costs and could delay your delivery depending on various factors. Changes also require confirmation from the Summit team before taking effect — we'll follow up within 1 business day.</span>
              </div>

              {/* Ship-to address — confirm what's on file, or expand to enter a new one */}
              <div className="field">
                <label>Ship-To Address <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(on file)</span></label>
                <div style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 8, fontSize: 13.5, color: 'var(--mut)', border: '1px solid var(--line)', marginBottom: 12 }}>
                  {billingAddressOnFile || <em>No billing address on file</em>}
                </div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  <span style={{ color: 'var(--rose)' }}>*</span> Is this the correct ship-to address?
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className={`chip${addressConfirmed === true ? ' on' : ''}`}
                    onClick={() => { setAddressConfirmed(true); setErrors(v => ({...v, addressConfirmed: ''})); }}>
                    Yes, this is correct
                  </button>
                  <button type="button" className={`chip${addressConfirmed === false ? ' on' : ''}`}
                    onClick={() => { setAddressConfirmed(false); setErrors(v => ({...v, addressConfirmed: ''})); }}>
                    No, I need to update it
                  </button>
                </div>
                {errors.addressConfirmed && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 4 }}>{errors.addressConfirmed}</div>}
                {addressConfirmed === false && (
                  <div style={{ marginTop: 16 }}>
                    <div className="hint" style={{ marginBottom: 10 }}>Enter your complete ship-to address below. Shipping outside the U.S.? Just fill in whichever fields apply to your country.</div>
                    <div className="field">
                      <label><span style={{ color: 'var(--rose)' }}>*</span> Address Line 1</label>
                      <input type="text" value={addressLine1} onChange={e => { setAddressLine1(e.target.value); setErrors(v => ({...v, addressLine1: ''})); }}
                        placeholder="Street address" style={{ borderColor: errors.addressLine1 ? 'var(--rose)' : '' }} />
                      {errors.addressLine1 && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.addressLine1}</div>}
                    </div>
                    <div className="field">
                      <label>Address Line 2 <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(optional)</span></label>
                      <input type="text" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Suite, unit, building, floor, etc." />
                    </div>
                    <div className="row">
                      <div className="field">
                        <label><span style={{ color: 'var(--rose)' }}>*</span> City</label>
                        <input type="text" value={addressCity} onChange={e => { setAddressCity(e.target.value); setErrors(v => ({...v, addressCity: ''})); }}
                          style={{ borderColor: errors.addressCity ? 'var(--rose)' : '' }} />
                        {errors.addressCity && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.addressCity}</div>}
                      </div>
                      <div className="field">
                        <label>State / Province / Region <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(if applicable)</span></label>
                        <input type="text" value={addressState} onChange={e => setAddressState(e.target.value)} placeholder="e.g. CO, Ontario, Bavaria" />
                      </div>
                      <div className="field" style={{ maxWidth: 160 }}>
                        <label>ZIP / Postal Code <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(if applicable)</span></label>
                        <input type="text" value={addressZip} onChange={e => setAddressZip(e.target.value)} />
                      </div>
                    </div>
                    <div className="field">
                      <label><span style={{ color: 'var(--rose)' }}>*</span> Country</label>
                      <input type="text" value={addressCountry} onChange={e => { setAddressCountry(e.target.value); setErrors(v => ({...v, addressCountry: ''})); }}
                        placeholder="United States" style={{ borderColor: errors.addressCountry ? 'var(--rose)' : '' }} />
                      {errors.addressCountry && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.addressCountry}</div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Loading dock — required, asked before delivery timing */}
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> Does your facility have a loading dock?</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={`chip${hasLoadingDock === 'no' ? ' on' : ''}`} onClick={() => setHasLoadingDock('no')}>
                    No, I need liftgate delivery
                  </button>
                  <button type="button" className={`chip${hasLoadingDock === 'yes' ? ' on' : ''}`} onClick={() => setHasLoadingDock('yes')}>
                    Yes, No need for lift gate delivery
                  </button>
                </div>
              </div>

              {/* Delivery timing — ship ASAP or schedule a preferred date */}
              <div className="field">
                <label><span style={{ color: 'var(--rose)' }}>*</span> How soon would you like us to schedule the delivery of your order?</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={`chip${deliveryTiming === 'asap' ? ' on' : ''}`}
                    onClick={() => { setDeliveryTiming('asap'); setPreferredDeliveryDate(''); setErrors(v => ({...v, deliveryTiming: '', preferredDeliveryDate: ''})); }}>
                    Ship as soon as my order is ready
                  </button>
                  <button type="button" className={`chip${deliveryTiming === 'scheduled' ? ' on' : ''}`}
                    onClick={() => { setDeliveryTiming('scheduled'); setErrors(v => ({...v, deliveryTiming: ''})); }}>
                    Schedule my preferred delivery date
                  </button>
                </div>
                {errors.deliveryTiming && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 4 }}>{errors.deliveryTiming}</div>}
                {deliveryTiming === 'scheduled' && (
                  <div style={{ marginTop: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 5 }}>
                      <span style={{ color: 'var(--rose)' }}>*</span> Schedule my delivery on or after this date
                    </label>
                    <input type="date" value={preferredDeliveryDate} min={today}
                      onChange={e => { setPreferredDeliveryDate(e.target.value); setErrors(v => ({...v, preferredDeliveryDate: ''})); }}
                      style={{ borderColor: errors.preferredDeliveryDate ? 'var(--rose)' : '', maxWidth: 220 }} />
                    {errors.preferredDeliveryDate && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.preferredDeliveryDate}</div>}
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
              <ReadField label="Ship-To Address" value={
                addressConfirmed === false
                  ? [addressLine1, addressLine2, addressCity, [addressState, addressZip].filter(Boolean).join(' '), addressCountry].filter(Boolean).join(', ') || '—'
                  : (billingAddressOnFile || '—')
              } />
              <ReadField label="Loading Dock at Facility" value={hasLoadingDock === 'yes' ? 'Yes, No need for lift gate delivery' : 'No, I need liftgate delivery'} />
              <ReadField label="Delivery Timing" value={
                !deliveryTiming ? 'Not yet set' :
                deliveryTiming === 'asap' ? 'Ship as soon as my order is ready' :
                `Schedule on or after ${preferredDeliveryDate || 'TBD'}`
              } />
              {errors.addressConfirmed && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.addressConfirmed}</div>}
              {errors.deliveryTiming && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.deliveryTiming}</div>}
              {errors.preferredDeliveryDate && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.preferredDeliveryDate}</div>}
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
  const rawFormId = order?.colorFormId;
  const formId = typeof rawFormId === 'string' ? rawFormId.trim() : '';
  const iframeId = formId ? `JotFormIFrame-${formId}` : null;

  // Load Jotform embed handler script and wire it up after iframe mounts
  useEffect(() => {
    if (!formId || !iframeId) return;

    function initHandler() {
      if (window.jotformEmbedHandler) {
        window.jotformEmbedHandler(`iframe[id='${iframeId}']`, 'https://form.jotform.com/');
      }
    }

    // If script already loaded from a previous render, just init
    if (window.jotformEmbedHandler) {
      initHandler();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js';
      script.onload = initHandler;
      document.body.appendChild(script);
    }

    // Detect form submission via postMessage
    function onMessage(e) {
      const raw = e.data;
      const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      if (data?.action === 'submission-completed') setFormSubmitted(true);
      if (typeof raw === 'string' && raw.includes('formSubmitted')) setFormSubmitted(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [formId, iframeId]);

  return (
    <>
      <div className="ph">
        <h2>Color & Product Selections</h2>
        <p>Complete your color selection form to finalize your equipment configuration.</p>
      </div>
      {completions.color && <div className="alert success" style={{ marginBottom: 16 }}>✅ Color selections submitted.</div>}
      {formSubmitted && <div className="alert success" style={{ marginBottom: 16 }}>✅ Form submitted! Click &quot;Mark as Complete&quot; below to continue.</div>}

      {formId ? (
        /* dangerouslySetInnerHTML isolates the iframe from React's reconciler.
           The Jotform embed handler moves DOM nodes outside React's knowledge,
           which causes "removeChild" crashes when React tries to reconcile. */
        <div
          key={formId}
          dangerouslySetInnerHTML={{
            __html: `<iframe
              id="${iframeId}"
              title="Color Selection Form"
              allowtransparency="true"
              allow="geolocation; microphone; camera; fullscreen; payment"
              src="https://form.jotform.com/${formId}"
              frameborder="0"
              class="jf-embed"
              style="min-width:100%;max-width:100%;height:539px;border:none;display:block;margin-bottom:16px;"
              scrolling="no"
            ></iframe>`,
          }}
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

// AfterShip carrier slug → friendly display name
const SLUG_NAMES = {
  fedex: 'FedEx', 'fedex-freight': 'FedEx Freight', ups: 'UPS', usps: 'USPS',
  dhl: 'DHL', estes: 'Estes', 'estes-express': 'Estes',
  'old-dominion-freight-line': 'Old Dominion', 'rl-carriers': 'R+L Carriers',
  xpo: 'XPO', saia: 'Saia',
};
function carrierFromSlug(slug) {
  if (!slug) return null;
  return SLUG_NAMES[slug] || slug;
}
function aftershipTrackUrl(slug, tracking) {
  return `https://track.aftership.com/${encodeURIComponent(slug)}/${encodeURIComponent((tracking || '').trim())}`;
}

function TrackingRow({ tracking, slug, expanded, trackingInfo, loading, onToggle }) {
  const carrierName = slug ? carrierFromSlug(slug) : getCarrierInfo(tracking).name;
  const events = trackingInfo?.events || [];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <code style={{ background: 'var(--paper)', padding: '4px 10px', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', letterSpacing: '.02em', border: '1px solid var(--line)' }}>
          {tracking}
        </code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} style={{ fontSize: 12 }}>
          {expanded ? 'Hide Tracking History ▲' : 'View Tracking History ▼'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, background: 'var(--paper)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--line)' }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--mut)' }}>Loading tracking details…</div>
          ) : trackingInfo ? (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Carrier</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{carrierName || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{trackingInfo.status}</div>
                </div>
                {trackingInfo.actualDelivery ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Delivered</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ok)' }}>{new Date(trackingInfo.actualDelivery).toLocaleDateString()}</div>
                  </div>
                ) : trackingInfo.estimatedDelivery ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 2 }}>Est. Delivery</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{new Date(trackingInfo.estimatedDelivery).toLocaleDateString()}</div>
                  </div>
                ) : null}
              </div>

              {events.length > 0 ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)', textTransform: 'uppercase', marginBottom: 10 }}>Transit History</div>
                  <div style={{ paddingLeft: 18 }}>
                    {events.map((ev, i) => (
                      <div key={i} style={{ position: 'relative', paddingBottom: i < events.length - 1 ? 16 : 0 }}>
                        <span style={{ position: 'absolute', left: -18, top: 3, width: 9, height: 9, borderRadius: '50%', background: i === 0 ? 'var(--moss)' : 'var(--line)', border: '2px solid var(--paper)', boxShadow: '0 0 0 1px var(--line)' }} />
                        {i < events.length - 1 && <span style={{ position: 'absolute', left: -14, top: 12, bottom: 0, width: 1, background: 'var(--line)' }} />}
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{ev.description}</div>
                        {ev.location && <div style={{ color: 'var(--mut)', fontSize: 12 }}>{ev.location}</div>}
                        {ev.timestamp && <div style={{ color: 'var(--mut)', fontSize: 11.5, marginTop: 1 }}>{new Date(ev.timestamp).toLocaleString()}</div>}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--mut)' }}>
                  This shipment has been registered. Detailed transit updates will appear here as the carrier scans it.
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--mut)' }}>
              Tracking details are being retrieved. Please check back shortly.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ title, slug, carrierLabel, trackingNumbers, shipped, notIncluded, expandedTracking, trackingData, loadingTracking, onToggleTracking, note, carrierPhone, carrierPhoneLabel }) {
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
              slug={slug}
              expanded={expandedTracking[t]}
              trackingInfo={trackingData[t]}
              loading={loadingTracking[t]}
              onToggle={() => onToggleTracking(t, slug)}
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

// ── Therapy Equipment & Accessories — per-item card (Monday subitems) ────────
// Three display tiers, matching the lifecycle Summit's team manages on the
// subitem's "Order Status" column: Order Pending → Ordered → (carrier +
// tracking entered) → full live AfterShip tracking, same fidelity as Frame
// and Mats. "Out of Stock" is a 4th staff-set state with its own message.
function accessoryStatusPill(item, hasTracking) {
  if (hasTracking) {
    const delivered = item.carrierStatus === 'Delivered';
    return { label: delivered ? '✓ DELIVERED' : '✓ SHIPPED', bg: 'var(--ok-lt)', color: 'var(--ok)' };
  }
  if (item.orderStatus === 'Out of Stock') return { label: 'OUT OF STOCK', bg: '#FEF3C7', color: '#92400E' };
  if (item.orderStatus === 'Ordered') return { label: 'ORDERED', bg: '#EFF6FF', color: '#1D4ED8' };
  return { label: 'ORDER PENDING', bg: 'var(--line)', color: 'var(--mut)' };
}

function AccessoryItem({ item, expandedTracking, trackingData, loadingTracking, onToggleTracking, isLast }) {
  const hasTracking = Boolean(item.carrierSlug && item.trackingNumber);
  const carrierLabel = item.carrierSlug ? carrierFromSlug(item.carrierSlug) : null;
  const pill = accessoryStatusPill(item, hasTracking);

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--line)', paddingBottom: isLast ? 0 : 14, marginBottom: isLast ? 0 : 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, letterSpacing: '.04em', background: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
      </div>

      {hasTracking ? (
        <>
          {carrierLabel && <div style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 8 }}>Carrier: {carrierLabel}</div>}
          <TrackingRow
            tracking={item.trackingNumber}
            slug={item.carrierSlug}
            expanded={expandedTracking[item.trackingNumber]}
            trackingInfo={trackingData[item.trackingNumber]}
            loading={loadingTracking[item.trackingNumber]}
            onToggle={() => onToggleTracking(item.trackingNumber, item.carrierSlug)}
          />
        </>
      ) : item.orderStatus === 'Out of Stock' ? (
        <div style={{ fontSize: 13.5, color: 'var(--mut)', fontStyle: 'italic' }}>
          This item is currently out of stock with our supplier. We'll update this section as soon as it's back in stock and ordered.
        </div>
      ) : item.orderStatus === 'Ordered' ? (
        <div style={{ fontSize: 13.5, color: 'var(--mut)', fontStyle: 'italic' }}>
          Product ordered{item.dateOrdered ? ` on ${item.dateOrdered}` : ''} — tracking information will be provided here once it becomes available.
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: 'var(--mut)', fontStyle: 'italic' }}>
          Product order pending. We'll update this section once it's been purchased on your behalf.
        </div>
      )}
    </div>
  );
}

function StatusTab({ order }) {
  const [expandedTracking, setExpandedTracking] = useState({});
  const [trackingData, setTrackingData] = useState({});
  const [loadingTracking, setLoadingTracking] = useState({});

  async function loadTracking(trackingNumber, slug) {
    if (trackingData[trackingNumber] || loadingTracking[trackingNumber]) return;
    setLoadingTracking(prev => ({ ...prev, [trackingNumber]: true }));
    try {
      const url = slug
        ? `/api/aftership/track?slug=${encodeURIComponent(slug)}&number=${encodeURIComponent(trackingNumber)}`
        : `/api/fedex/track?number=${encodeURIComponent(trackingNumber)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTrackingData(prev => ({ ...prev, [trackingNumber]: data.tracking }));
      }
    } catch {}
    finally { setLoadingTracking(prev => ({ ...prev, [trackingNumber]: false })); }
  }

  function toggleTracking(t, slug) {
    const nowExpanded = !expandedTracking[t];
    setExpandedTracking(prev => ({ ...prev, [t]: nowExpanded }));
    if (nowExpanded) loadTracking(t, slug);
  }

  const stages = order.stages || [];
  const shippedIdx = stages.findIndex(s => s.key === 'shipped');
  const deliveredIdx = stages.findIndex(s => s.key === 'delivered');
  const isShipped = order.stageIndex >= shippedIdx && shippedIdx >= 0;
  const isDelivered = order.stageIndex >= deliveredIdx && deliveredIdx >= 0;

  // Shipment carrier slug + tracking number (AfterShip inputs; fall back to legacy fields)
  const frameSlug = order.frameCarrierSlug || '';
  const frameNumber = order.frameTrackingId || order.trackingNumber || '';
  const frameTrackings = frameNumber ? [frameNumber] : [];

  const matsSlug = order.matsCarrierSlug || '';
  const matsNumber = order.matsTrackingId || '';
  const matTrackings = matsNumber
    ? [matsNumber]
    : (order.matTracking && order.matTracking !== 'N/A'
        ? order.matTracking.split(',').map(t => t.trim()).filter(Boolean)
        : []);

  // Therapy Equipment & Accessories — one entry per Monday subitem
  const accessoryItems = order.accessoryItems || [];

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
        slug={frameSlug}
        carrierLabel={carrierFromSlug(frameSlug) || 'FedEx Freight'}
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
        slug={matsSlug}
        carrierLabel={carrierFromSlug(matsSlug) || (matTrackings.length > 0 ? 'Standard Carrier' : null)}
        trackingNumbers={matTrackings}
        shipped={matTrackings.length > 0}
        notIncluded={order.matTracking === 'N/A'}
        note="Mats and padding ship separately and may arrive on a different day than your frame."
        {...sharedProps}
      />

      {/* Therapy Equipment & Accessories — misc items sourced from Monday subitems */}
      {accessoryItems.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Therapy Equipment & Accessories</h3></div>
          {accessoryItems.map((item, i) => (
            <AccessoryItem
              key={item.id}
              item={item}
              isLast={i === accessoryItems.length - 1}
              {...sharedProps}
            />
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
  /**
   * Returns { type: 'iframe'|'video', src } for any URL we can embed
   * inline, or null if it has to stay an external link. Covers YouTube
   * (watch/short/shorts/already-embed links), Vimeo (public + private
   * "unlisted" links with a hash), Loom, Google Drive, Dropbox, and
   * direct video files (served straight from Monday or anywhere else).
   */
  function getEmbed(url) {
    if (!url) return null;

    // YouTube — watch, youtu.be, shorts, or an already-embed URL
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/);
    if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?rel=0` };

    // Vimeo — public (vimeo.com/12345) or private/unlisted, which carries a
    // share hash either as a path segment (vimeo.com/12345/abcdef1234) or a
    // query param (player.vimeo.com/video/12345?h=abcdef1234)
    const vimeoId = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoId) {
      const pathHash = url.match(/vimeo\.com\/\d+\/([a-z0-9]+)/i)?.[1];
      const queryHash = url.match(/[?&]h=([a-z0-9]+)/i)?.[1];
      const hash = pathHash || queryHash;
      return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeoId[1]}${hash ? `?h=${hash}` : ''}` };
    }

    // Loom
    const loom = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loom) return { type: 'iframe', src: `https://www.loom.com/embed/${loom[1]}` };

    // Google Drive shared file
    const drive = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (drive) return { type: 'iframe', src: `https://drive.google.com/file/d/${drive[1]}/preview` };

    // Dropbox share link — force a direct/raw stream instead of the preview page
    if (url.includes('dropbox.com') && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) {
      const direct = url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=0/, '');
      return { type: 'video', src: direct };
    }

    // A direct video file — Monday-hosted assets, S3, etc.
    if (/\.(mp4|mov|webm|m4v|ogg)(\?|$)/i.test(url)) {
      return { type: 'video', src: url };
    }

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
                const embed = getEmbed(url);
                if (!embed) {
                  return (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <a href={url} target="_blank" rel="noreferrer" className="btn btn-ghost">▶ View Video →</a>
                    </div>
                  );
                }
                if (embed.type === 'video') {
                  return (
                    <div key={i} style={{ marginBottom: i < videos.length - 1 ? 20 : 0 }}>
                      <video
                        src={embed.src}
                        controls
                        playsInline
                        style={{ width: '100%', maxHeight: 480, borderRadius: 10, background: '#000', display: 'block' }}
                      />
                    </div>
                  );
                }
                return (
                  <div key={i} style={{ marginBottom: i < videos.length - 1 ? 20 : 0 }}>
                    <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
                      <iframe
                        src={embed.src}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={`Installation Video ${i + 1}`}
                      />
                    </div>
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
              className="jf-embed"
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

// ── Tab: Refer a Friend ────────────────────────────────────────────────────────

function ReferralTab({ order, showToast }) {
  const [friendName, setFriendName] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [friendPhone, setFriendPhone] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  function validate() {
    const e = {};
    if (!friendName.trim()) e.friendName = 'Required';
    if (!friendEmail.trim()) e.friendEmail = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(friendEmail.trim())) e.friendEmail = 'Enter a valid email address';
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      showToast('Please complete the required fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await fetch('/api/referral/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendName, friendEmail, friendPhone, message }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Referral submission failed.');
      }
      setSubmitted(true);
      setFriendName(''); setFriendEmail(''); setFriendPhone(''); setMessage('');
      showToast('Thanks for the referral!');
    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ph">
        <h2>Refer a Friend</h2>
        <p>Know a clinic, school, or family who could use a sensory therapy gym? Send us their info and we'll take it from there.</p>
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--moss)' }}>
        <div className="ch"><h3>🎁 How It Works</h3></div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 10 }}>
          Refer someone to Summit Sensory Gym, and once they place an order, you'll receive a reward based on their purchase — <strong>2% of their order value</strong>, with a <strong>$25 minimum</strong> and up to <strong>$500</strong>. Rewards are typically issued as account credit toward your own future orders or accessories; for smaller individual referrals, we're happy to discuss a gift card instead.
        </p>
        <p style={{ fontSize: 13, color: 'var(--mut)', margin: 0 }}>
          We'll reach out to your friend directly and keep you posted on where things stand.
        </p>
      </div>

      {submitted && (
        <div className="alert success" style={{ marginBottom: 16 }}>✅ Referral submitted — thank you! We'll be in touch with them soon.</div>
      )}

      <form onSubmit={submit}>
        <div className="card">
          <div className="ch"><h3>Referral Details</h3></div>
          <div className="row">
            <div className="field">
              <label><span style={{ color: 'var(--rose)' }}>*</span> Friend's Name</label>
              <input type="text" value={friendName} onChange={e => { setFriendName(e.target.value); setErrors(v => ({ ...v, friendName: '' })); }} style={{ borderColor: errors.friendName ? 'var(--rose)' : '' }} />
              {errors.friendName && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.friendName}</div>}
            </div>
            <div className="field">
              <label><span style={{ color: 'var(--rose)' }}>*</span> Friend's Email</label>
              <input type="email" value={friendEmail} onChange={e => { setFriendEmail(e.target.value); setErrors(v => ({ ...v, friendEmail: '' })); }} style={{ borderColor: errors.friendEmail ? 'var(--rose)' : '' }} />
              {errors.friendEmail && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.friendEmail}</div>}
            </div>
          </div>
          <div className="field">
            <label>Friend's Phone <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(optional)</span></label>
            <input type="tel" value={friendPhone} onChange={e => setFriendPhone(e.target.value)} placeholder="+1 303 555 0100" />
          </div>
          <div className="field">
            <label>Note to Our Team <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(optional)</span></label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Anything helpful for us to know — their organization, timeline, etc." />
          </div>
          <button className="btn btn-moss" disabled={saving}>{saving ? 'Submitting…' : 'Submit Referral →'}</button>
        </div>
      </form>
    </>
  );
}

// ── Tab: Photo & Video Showcase ─────────────────────────────────────────────────

// Jotform query-param keys that prefill the Showcase form's Full Name,
// Organization, and Email Address fields (confirmed against the live form —
// Jotform's internal field "name" attributes don't always match what it
// actually reads for URL prefill, so these were verified empirically).
const SHOWCASE_PREFILL_KEYS = { fullName: 'q2_textbox0', organization: 'yourName', email: 'q3_email1' };

function buildShowcaseFormUrl(formId, order) {
  const params = new URLSearchParams();
  const orgName = order?.name ? order.name.split(' - ')[0].trim() : '';
  if (order?.contactName) params.set(SHOWCASE_PREFILL_KEYS.fullName, order.contactName);
  if (orgName) params.set(SHOWCASE_PREFILL_KEYS.organization, orgName);
  if (order?.contactEmail) params.set(SHOWCASE_PREFILL_KEYS.email, order.contactEmail);
  const qs = params.toString();
  return `https://form.jotform.com/${formId}${qs ? `?${qs}` : ''}`;
}

function ShowcaseTab({ order }) {
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const rawFormId = order?.showcaseFormId;
  const formId = typeof rawFormId === 'string' ? rawFormId.trim() : '';
  const iframeId = formId ? `JotFormIFrame-${formId}` : null;
  const formSrc = formId ? buildShowcaseFormUrl(formId, order) : '';

  useEffect(() => {
    if (!formId || !iframeId) return;

    function initHandler() {
      if (window.jotformEmbedHandler) {
        window.jotformEmbedHandler(`iframe[id='${iframeId}']`, 'https://form.jotform.com/');
      }
    }
    if (window.jotformEmbedHandler) {
      initHandler();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js';
      script.onload = initHandler;
      document.body.appendChild(script);
    }

    function onMessage(e) {
      const raw = e.data;
      const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      if (data?.action === 'submission-completed') setFormSubmitted(true);
      if (typeof raw === 'string' && raw.includes('formSubmitted')) setFormSubmitted(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [formId, iframeId]);

  async function emailMeLink() {
    setEmailSending(true);
    try {
      const res = await fetch('/api/portal/email-upload-link', { method: 'POST' });
      if (!res.ok) throw new Error();
      setEmailSent(true);
    } catch {
      setEmailSent(false);
    } finally {
      setEmailSending(false);
    }
  }

  return (
    <>
      <div className="ph">
        <h2>Photo & Video Showcase</h2>
        <p>Show off your new sensory gym — and earn rewards for sharing it.</p>
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--moss)' }}>
        <div className="ch"><h3>📸 Share Your Gym, Earn Rewards</h3></div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 10 }}>
          We love seeing your space in action — and your photos and videos help other clinics, schools, and families picture what's possible. Submit <strong>10 photos or videos</strong> (1 video counts as 2) and we'll send you a <strong>$25 gift card</strong>. Keep sharing — the reward repeats every 10 submissions.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 10, color: 'var(--mut)' }}>
          For videos: please film for at least <strong>20 seconds</strong>, capture <strong>different angles</strong>, and if possible, show <strong>people using the frame</strong> — these submit for review fastest.
        </p>
        <p style={{ fontSize: 13, color: 'var(--mut)', margin: 0 }}>
          Our team gives every batch a quick look before rewards go out, just to confirm the basics above.
        </p>
      </div>

      {formSubmitted && <div className="alert success" style={{ marginBottom: 16 }}>✅ Thanks for sharing! We'll review your submission shortly.</div>}

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Uploading from your phone?</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--mut)' }}>Email yourself this upload link so you can snap and upload photos right from your camera roll.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={emailMeLink} disabled={emailSending || emailSent || !formId}>
          {emailSent ? '✅ Sent!' : emailSending ? 'Sending…' : 'Email Me This Link'}
        </button>
      </div>

      {formId ? (
        <div
          key={formId}
          dangerouslySetInnerHTML={{
            __html: `<iframe
              id="${iframeId}"
              title="Photo & Video Showcase Form"
              allowtransparency="true"
              allow="geolocation; microphone; camera; fullscreen; payment"
              src="${formSrc}"
              frameborder="0"
              class="jf-embed"
              style="min-width:100%;max-width:100%;height:539px;border:none;display:block;margin-bottom:16px;"
              scrolling="no"
            ></iframe>`,
          }}
        />
      ) : (
        <div className="card">
          <div className="empty">
            <div className="ei">📸</div>
            <h3>Upload form not yet available</h3>
            <p>We're setting this up — check back soon, or contact us directly if you'd like to share photos or videos now.</p>
          </div>
        </div>
      )}
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
