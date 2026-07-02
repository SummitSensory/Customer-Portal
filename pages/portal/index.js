/**
 * Customer Portal
 * Two navigation groups:
 *   ACCOUNT SETUP  — 7 sequential tabs customers complete once
 *   MY ORDER       — ongoing access to order status, files, messages
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// ── Navigation config ─────────────────────────────────────────────────────────

const SETUP_TABS = [
  { id: 'contact',   label: 'Contact Information',        icon: '👤' },
  { id: 'billing',   label: 'Billing Information',         icon: '💳' },
  { id: 'delivery',  label: 'Delivery Details',            icon: '🚚' },
  { id: 'site',      label: 'Site Readiness',              icon: '🏗️' },
  { id: 'color',     label: 'Color & Product Selections',  icon: '🎨' },
  { id: 'documents', label: 'Required Documents',          icon: '📋' },
  { id: 'summary',   label: 'Order Summary',               icon: '✅' },
];

const ORDER_TABS = [
  { id: 'status',   label: 'Order Status & Tracking', icon: '📦' },
  { id: 'files',    label: 'Files',                   icon: '📄' },
  { id: 'messages', label: 'Messages',                icon: '💬' },
  { id: 'invoice',  label: 'Invoice',                 icon: '💰' },
];

// ── Main portal ───────────────────────────────────────────────────────────────

export default function CustomerPortal() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('contact');
  const [order, setOrder] = useState(null);
  const [orders, setOrders] = useState(null);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tracking, setTracking] = useState(null);
  const [formMap, setFormMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [completions, setCompletions] = useState({});
  const [toast, setToast] = useState('');

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

  const loadTracking = useCallback(async () => {
    if (!order?.trackingNumber) return;
    try {
      const res = await fetch(`/api/fedex/track?number=${order.trackingNumber}`);
      if (res.ok) setTracking((await res.json()).tracking);
    } catch {}
  }, [order]);

  useEffect(() => { loadOrder(); }, [loadOrder]);
  useEffect(() => {
    if (order) { loadFiles(); loadMessages(); loadTracking(); }
  }, [order, loadFiles, loadMessages, loadTracking]);

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
  const setupComplete = SETUP_TABS.filter(t => t.id !== 'summary').every(t => completions[t.id]);
  const setupCount = SETUP_TABS.filter(t => t.id !== 'summary' && completions[t.id]).length;
  const setupTotal = SETUP_TABS.length - 1;
  const unreadMessages = messages.filter(m => !m.creator?.email?.includes('summitsensorygym')).length;

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
          <div className="brand">
            <div className="logo" style={{ width: 30, height: 30, borderRadius: 8 }} />
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
                const done = tab.id === 'summary' ? setupComplete : completions[tab.id];
                const isActive = activeTab === tab.id;
                const needsAction = tab.id !== 'summary' && !done;
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
            {activeTab === 'contact'   && <ContactTab   order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('billing')} />}
            {activeTab === 'billing'   && <BillingTab   order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('delivery')} onBack={() => setActiveTab('contact')} />}
            {activeTab === 'delivery'  && <DeliveryTab  order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('site')} onBack={() => setActiveTab('billing')} />}
            {activeTab === 'site'      && <SiteTab      order={order} completions={completions} markComplete={markComplete} showToast={showToast} onNext={() => setActiveTab('color')} onBack={() => setActiveTab('delivery')} />}
            {activeTab === 'color'     && <ColorTab     order={order} completions={completions} markComplete={markComplete} showToast={showToast} colorForms={colorForms} onNext={() => setActiveTab('documents')} onBack={() => setActiveTab('site')} />}
            {activeTab === 'documents' && <DocumentsTab order={order} completions={completions} markComplete={markComplete} showToast={showToast} docForms={docForms} onNext={() => setActiveTab('summary')} onBack={() => setActiveTab('color')} />}
            {activeTab === 'summary'   && <SummaryTab   order={order} completions={completions} formMap={formMap} productForms={productForms} onNav={setActiveTab} setupComplete={setupComplete} />}
            {activeTab === 'status'    && <StatusTab    order={order} tracking={tracking} />}
            {activeTab === 'files'     && <FilesTab     files={files} />}
            {activeTab === 'messages'  && <MessagesTab  order={order} messages={messages} onRefresh={loadMessages} showToast={showToast} />}
            {activeTab === 'invoice'   && <InvoiceTab   order={order} />}
          </main>
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
  const [saving, setSaving] = useState(false);

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
      <div className="ph"><h2>Contact Information</h2><p>Please confirm the primary contact details we have on file for your order.</p></div>
      {completions.contact && <div className="alert success" style={{ marginBottom: 16 }}>✅ Contact information confirmed.</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Primary Contact</h3></div>
        <div className="grid g2">
          <ReadField label="Name" value={order.pocName || order.firstName || '—'} />
          <ReadField label="Email" value={order.customerEmail || '—'} />
          <ReadField label="Phone" value={order.phone || '—'} />
          <ReadField label="Organization" value={order.name ? order.name.split(' - ')[0] : '—'} />
        </div>
        <div className="alert info" style={{ marginTop: 16 }}>
          <span>ℹ️</span>
          <span>If any of this information is incorrect, please message us through the <strong>Messages</strong> tab and we'll update it for you.</span>
        </div>
      </div>
      <TabNav onNext={confirm} nextLabel={saving ? 'Saving…' : 'Confirm & Continue'} saving={saving} />
    </>
  );
}

// ── Tab: Billing Information ──────────────────────────────────────────────────

function BillingTab({ order, completions, markComplete, showToast, onNext, onBack }) {
  const [sameAsDelivery, setSameAsDelivery] = useState(true);
  const [billingAddress, setBillingAddress] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingZip, setBillingZip] = useState('');
  const [sameContact, setSameContact] = useState(true);
  const [billingName, setBillingName] = useState('');
  const [billingPhone, setBillingPhone] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSetup('billing', {
        billingSameAsDelivery: sameAsDelivery,
        billingAddress, billingCity, billingState, billingZip,
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
      <div className="ph"><h2>Billing Information</h2><p>Confirm your billing address and the contact responsible for payment.</p></div>
      {completions.billing && <div className="alert success" style={{ marginBottom: 16 }}>✅ Billing information saved.</div>}
      <form onSubmit={submit}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Bill-To Address</h3></div>
          <label className="sw" style={{ marginBottom: 16, cursor: 'pointer' }}>
            <div className={`toggle${sameAsDelivery ? ' on' : ''}`} onClick={() => setSameAsDelivery(v => !v)} />
            <span>Same as delivery address</span>
          </label>
          {!sameAsDelivery && (
            <>
              <div className="field">
                <label>Street Address</label>
                <input type="text" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} placeholder="123 Main St" required />
              </div>
              <div className="row">
                <div className="field">
                  <label>City</label>
                  <input type="text" value={billingCity} onChange={e => setBillingCity(e.target.value)} required />
                </div>
                <div className="field" style={{ maxWidth: 80 }}>
                  <label>State</label>
                  <input type="text" value={billingState} onChange={e => setBillingState(e.target.value)} maxLength={2} placeholder="CO" required />
                </div>
                <div className="field" style={{ maxWidth: 120 }}>
                  <label>Zip</label>
                  <input type="text" value={billingZip} onChange={e => setBillingZip(e.target.value)} maxLength={10} required />
                </div>
              </div>
            </>
          )}
          {sameAsDelivery && order.address && (
            <div style={{ padding: '10px 14px', background: 'var(--paper)', borderRadius: 8, fontSize: 13.5, color: 'var(--mut)' }}>
              {order.address}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Billing Point of Contact</h3></div>
          <label className="sw" style={{ marginBottom: 16, cursor: 'pointer' }}>
            <div className={`toggle${sameContact ? ' on' : ''}`} onClick={() => setSameContact(v => !v)} />
            <span>Same as primary contact ({order.pocName || order.customerEmail})</span>
          </label>
          {!sameContact && (
            <>
              <div className="field">
                <label>Billing Contact Name</label>
                <input type="text" value={billingName} onChange={e => setBillingName(e.target.value)} placeholder="Full name" required />
              </div>
              <div className="row">
                <div className="field">
                  <label>Phone</label>
                  <input type="tel" value={billingPhone} onChange={e => setBillingPhone(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Email</label>
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
  const [pocName, setPocName] = useState(order.pocName || '');
  const [pocPhone, setPocPhone] = useState(order.phone || '');
  const [pocEmail, setPocEmail] = useState(order.pocEmail || '');
  const [specialInstructions, setSpecialInstructions] = useState(order.deliveryInstructions || '');
  // Restricted fields
  const [deliveryAddress, setDeliveryAddress] = useState(order.address || '');
  const [liftgate, setLiftgate] = useState(null);
  const [loadingDock, setLoadingDock] = useState(null);
  // Date range delivery window
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  // Communication preferences
  const [commMethod, setCommMethod] = useState('Email');
  const [smsConsent, setSmsConsent] = useState(false);
  const [mobilePhone, setMobilePhone] = useState('');
  // Freight ack
  const [ackRead, setAckRead] = useState(false);
  const [ackName, setAckName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showRestrictionNote, setShowRestrictionNote] = useState(false);
  const [errors, setErrors] = useState({});

  // Get today's date in YYYY-MM-DD for min attribute
  const today = new Date().toISOString().split('T')[0];

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
    if (commMethod === 'Text Message' && smsConsent && !mobilePhone.trim()) e.mobilePhone = 'Required for text messaging';
    if (windowStart && !isWeekday(windowStart)) e.windowStart = 'Must be a weekday';
    if (windowEnd && !isWeekday(windowEnd)) e.windowEnd = 'Must be a weekday';
    if (windowStart && windowEnd && windowEnd < windowStart) e.windowEnd = 'End date must be after start date';
    if (!ackRead) e.ackRead = 'Required';
    if (!ackName.trim()) e.ackName = 'Required';
    return e;
  }

  function getChangedRestricted() {
    const changed = [];
    if (deliveryAddress && deliveryAddress !== order.address) changed.push('Delivery Address');
    if (liftgate !== null) changed.push('Liftgate Required');
    if (loadingDock !== null) changed.push('Loading Dock Available');
    if (windowStart || windowEnd) changed.push('Preferred Delivery Window');
    return changed;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      showToast('Please complete all required fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    const changedRestricted = getChangedRestricted();
    const deliveryWindow = windowStart || windowEnd
      ? `${windowStart || 'TBD'} to ${windowEnd || 'TBD'}`
      : '';
    try {
      await saveSetup('delivery', {
        pocName, pocPhone, pocEmail, specialInstructions,
        commMethod, smsConsent, mobilePhone,
        deliveryAddress, liftgate, loadingDock, deliveryWindow,
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
          <button className="btn btn-moss" style={{ marginTop: 20 }} onClick={onNext}>Continue to Site Readiness →</button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="ph"><h2>Delivery Details</h2><p>Confirm how and where your order will be delivered.</p></div>
      {completions.delivery && <div className="alert success" style={{ marginBottom: 16 }}>✅ Delivery details confirmed.</div>}
      <form onSubmit={submit}>

        {/* Delivery POC */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Delivery Point of Contact</h3></div>
          <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 16 }}>The person who will be on-site to receive the delivery.</p>
          <div className="row">
            <div className="field">
              <label><span style={{ color: 'var(--rose)' }}>*</span> Full Name</label>
              <input type="text" value={pocName} onChange={e => { setPocName(e.target.value); setErrors(v => ({...v, pocName: ''})); }} style={{ borderColor: errors.pocName ? 'var(--rose)' : '' }} />
              {errors.pocName && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.pocName}</div>}
            </div>
            <div className="field">
              <label><span style={{ color: 'var(--rose)' }}>*</span> Phone</label>
              <input type="tel" value={pocPhone} onChange={e => { setPocPhone(e.target.value); setErrors(v => ({...v, pocPhone: ''})); }} style={{ borderColor: errors.pocPhone ? 'var(--rose)' : '' }} />
              {errors.pocPhone && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.pocPhone}</div>}
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
        </div>

        {/* Communication preferences */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Communication Preferences</h3></div>
          <div className="field">
            <label>Preferred Communication Method</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              {['Phone Call', 'Text Message', 'Email'].map(v => (
                <button key={v} type="button"
                  className={`chip${commMethod === v ? ' on' : ''}`}
                  onClick={() => setCommMethod(v)}>
                  {v === 'Phone Call' ? '📞' : v === 'Text Message' ? '💬' : '📧'} {v}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 500 }}>
              <input type="checkbox" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)} style={{ width: 'auto' }} />
              I consent to receiving text message communications from Summit Sensory Gym regarding my order
            </label>
          </div>
          {smsConsent && (
            <div className="field">
              <label>{commMethod === 'Text Message' ? <><span style={{ color: 'var(--rose)' }}>*</span> </> : ''}Mobile Number for Text Messages</label>
              <input type="tel" value={mobilePhone} onChange={e => { setMobilePhone(e.target.value); setErrors(v => ({...v, mobilePhone: ''})); }}
                placeholder="(303) 555-0100"
                style={{ borderColor: errors.mobilePhone ? 'var(--rose)' : '' }} />
              {errors.mobilePhone && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.mobilePhone}</div>}
              <div className="hint">Standard message and data rates may apply.</div>
            </div>
          )}
        </div>

        {/* Restricted fields */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ch"><h3>Delivery Logistics</h3></div>
          <div className="alert warn" style={{ marginBottom: 16 }}>
            <span>⚠️</span>
            <span>Changes to the fields below require confirmation from the Summit team before taking effect. We'll follow up within 1 business day.</span>
          </div>
          <div className="field">
            <label>Delivery Address <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(update if changed)</span></label>
            <input type="text" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} />
          </div>
          <div className="field">
            <label>Liftgate Required?</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {['Yes', 'No', 'Unsure'].map(v => (
                <button key={v} type="button" className={`chip${liftgate === v ? ' on' : ''}`} onClick={() => setLiftgate(v)}>{v}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Loading Dock Available?</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {['Yes', 'No'].map(v => (
                <button key={v} type="button" className={`chip${loadingDock === v ? ' on' : ''}`} onClick={() => setLoadingDock(v)}>{v}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Preferred Delivery Window <span style={{ fontWeight: 400, color: 'var(--mut)' }}>(weekdays only)</span></label>
            <div className="row">
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, color: 'var(--mut)' }}>Earliest date</label>
                <input type="date" value={windowStart} min={today}
                  onChange={e => { setWindowStart(e.target.value); setErrors(v => ({...v, windowStart: ''})); }}
                  style={{ borderColor: errors.windowStart ? 'var(--rose)' : '' }} />
                {errors.windowStart && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowStart}</div>}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 12, color: 'var(--mut)' }}>Latest date</label>
                <input type="date" value={windowEnd} min={windowStart || today}
                  onChange={e => { setWindowEnd(e.target.value); setErrors(v => ({...v, windowEnd: ''})); }}
                  style={{ borderColor: errors.windowEnd ? 'var(--rose)' : '' }} />
                {errors.windowEnd && <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 3 }}>{errors.windowEnd}</div>}
              </div>
            </div>
            <div className="hint">Deliveries are made Monday–Friday. Weekend dates will not be accepted.</div>
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
            <label><span style={{ color: 'var(--rose)' }}>*</span> Your Full Name (acknowledgment signature)</label>
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

// ── Tab: Site Readiness ───────────────────────────────────────────────────────

function SiteTab({ order, completions, markComplete, showToast, onNext, onBack }) {
  return (
    <>
      <div className="ph"><h2>Site Readiness</h2><p>Complete any site readiness requirements before your order can ship.</p></div>
      {completions.site && <div className="alert success" style={{ marginBottom: 16 }}>✅ Site readiness confirmed.</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Site Checklist</h3></div>
        <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>
          Before your equipment ships, please confirm your site meets the following requirements:
        </p>
        {[
          'Installation room dimensions have been confirmed with Summit Sensory Gym',
          'Flooring installation is complete or will be complete before delivery',
          'Clear pathway from entry to installation room (minimum 36" wide)',
          'Electrical and anchor point requirements have been reviewed',
          'Site contact will be available on the scheduled delivery date',
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
            <span style={{ color: 'var(--moss)', fontWeight: 700, flex: 'none' }}>✓</span>
            <span>{item}</span>
          </div>
        ))}
        <div className="alert info" style={{ marginTop: 16 }}>
          <span>ℹ️</span>
          <span>If any of the above items need attention, please contact us before proceeding. Your order will not ship until site readiness is confirmed.</span>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Confirm Site Readiness</h3></div>
        <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 16 }}>
          By clicking confirm, you're letting us know that the items above are or will be in place before your delivery date.
        </p>
        <button
          className="btn btn-moss"
          onClick={async () => {
            try {
              await saveSetup('contact', { note: 'Site readiness confirmed' });
              markComplete('site');
              showToast('Site readiness confirmed.');
              onNext();
            } catch { showToast('Error. Please try again.'); }
          }}
        >
          Confirm Site Readiness & Continue →
        </button>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
    </>
  );
}

// ── Tab: Color & Product Selections ──────────────────────────────────────────

function ColorTab({ order, completions, markComplete, showToast, colorForms, onNext, onBack }) {
  return (
    <>
      <div className="ph"><h2>Color & Product Selections</h2><p>Complete your color selection form to finalize your equipment configuration.</p></div>
      {completions.color && <div className="alert success" style={{ marginBottom: 16 }}>✅ Color selections submitted.</div>}

      {colorForms.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="ei">🎨</div>
            <h3>No color form required</h3>
            <p>No color selection form is configured for your product type. Contact Summit Sensory Gym if you have questions.</p>
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

// ── Tab: Order Summary ────────────────────────────────────────────────────────

function SummaryTab({ order, completions, formMap, productForms, onNav, setupComplete }) {
  const allTabs = SETUP_TABS.filter(t => t.id !== 'summary');

  return (
    <>
      <div className="ph">
        <h2>Order Summary</h2>
        <p>{setupComplete ? 'Your account setup is complete. Here\'s a summary of everything submitted.' : 'Review your progress and complete any remaining steps.'}</p>
      </div>

      {setupComplete ? (
        <div className="alert success" style={{ marginBottom: 20 }}>
          <span>🎉</span>
          <strong>Account setup complete! Your information has been received by the Summit Sensory Gym team.</strong>
        </div>
      ) : (
        <div className="alert warn" style={{ marginBottom: 20 }}>
          <span>⚠️</span>
          <span>Some steps are still incomplete. Please complete all sections before your order can proceed to manufacturing.</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Setup Checklist</h3></div>
        {allTabs.map(tab => (
          <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px', borderBottom: '1px solid var(--line)' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: completions[tab.id] ? 'var(--ok)' : 'var(--sun-lt)',
              color: completions[tab.id] ? '#fff' : 'var(--sun)', fontSize: 13, flex: 'none'
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Order Details</h3></div>
        <ReadField label="Order" value={order.name} />
        <ReadField label="Product" value={order.productType || '—'} />
        <ReadField label="Status" value={order.status || '—'} />
        <ReadField label="Projected Ship Date" value={order.shipDate || 'TBD'} />
        <ReadField label="Delivery Address" value={order.address || '—'} />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-ghost" onClick={() => onNav('status')}>View Order Status →</button>
        <button className="btn btn-ghost" onClick={() => onNav('messages')}>Message Our Team →</button>
      </div>
    </>
  );
}

// ── Tab: Order Status & Tracking ──────────────────────────────────────────────

function StatusTab({ order, tracking }) {
  const stages = order.stages || [];
  const isShipped = order.stageIndex >= stages.findIndex(s => s.key === 'shipped');
  return (
    <>
      <div className="ph"><h2>Order Status & Tracking</h2><p>Your order's progress from manufacturing to delivery.</p></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="ch"><h3>Manufacturing Timeline</h3></div>
        <div className="tl">
          {stages.map((stage, i) => {
            const isDone = i < order.stageIndex;
            const isCur = i === order.stageIndex;
            return (
              <div key={stage.key} className={`step${isDone ? ' done' : ''}${isCur ? ' cur' : ''}`}>
                <div className="sd">{isDone ? '✓' : isCur ? '●' : i + 1}</div>
                <div className="sb">
                  <div className="t">{stage.icon} {stage.label}</div>
                  {isCur && <div className="d" style={{ color: 'var(--moss)' }}>Current stage</div>}
                  {isDone && stage.key === 'shipped' && order.shipDate && <div className="d">Shipped {order.shipDate}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {isShipped && order.trackingNumber && (
        <div className="card">
          <div className="ch"><h3>🚚 FedEx Tracking</h3></div>
          <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 12 }}>
            Tracking number: <strong style={{ color: 'var(--ink)' }}>{order.trackingNumber}</strong>
          </p>
          {tracking ? (
            <>
              <div className="alert info" style={{ marginBottom: 12 }}>
                <strong>{tracking.status}</strong>
                {tracking.estimatedDelivery && <span style={{ marginLeft: 8, fontSize: 12.5 }}>Est. delivery: {new Date(tracking.estimatedDelivery).toLocaleDateString()}</span>}
              </div>
              {tracking.events.slice(0, 5).map((ev, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{ev.description}</span>
                  {ev.location && <span style={{ color: 'var(--mut)', marginLeft: 8 }}>{ev.location}</span>}
                  {ev.timestamp && <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 2 }}>{new Date(ev.timestamp).toLocaleString()}</div>}
                </div>
              ))}
              <a href={tracking.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}>View on FedEx.com →</a>
            </>
          ) : <p style={{ color: 'var(--mut)', fontSize: 13.5 }}>Tracking details loading…</p>}
        </div>
      )}
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
      <div className="ph"><h2>Files</h2><p>Documents and files shared by the Summit Sensory Gym team.</p></div>
      <div className="card">
        {files.length === 0 ? (
          <div className="empty"><div className="ei">📁</div><h3>No files yet</h3><p>Files shared by Summit will appear here.</p></div>
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

// ── Tab: Invoice ──────────────────────────────────────────────────────────────

function InvoiceTab({ order }) {
  return (
    <>
      <div className="ph"><h2>Invoice</h2><p>Access your order invoice.</p></div>
      <div className="card">
        {order.invoiceLink ? (
          <>
            <div className="ch"><h3>Your Invoice</h3></div>
            <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>Your invoice is available to view or download. If you have questions about your invoice, please contact us.</p>
            <a href={order.invoiceLink} target="_blank" rel="noreferrer" className="btn btn-moss" style={{ display: 'inline-flex' }}>
              📄 View Invoice →
            </a>
          </>
        ) : (
          <div className="empty">
            <div className="ei">💰</div>
            <h3>Invoice not yet available</h3>
            <p>Your invoice will appear here once it's been generated. Contact us at <a href="mailto:orders@summitsensorygym.com" style={{ color: 'var(--moss)' }}>orders@summitsensorygym.com</a> with questions.</p>
          </div>
        )}
      </div>
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

  // Filter out internal tagged updates
  const visibleMessages = messages.filter(m =>
    !m.body?.startsWith('[PORTAL:') && !m.body?.startsWith('[BILLING]')
  );

  return (
    <>
      <div className="ph"><h2>Messages</h2><p>Direct communication with the Summit Sensory Gym team.</p></div>
      <div className="card pad0">
        <div className="chat">
          <div className="chat-h">Order: {order.name}</div>
          <div className="chat-b">
            {visibleMessages.length === 0 && (
              <div className="empty" style={{ padding: '30px 0' }}>
                <div className="ei">💬</div><h3>No messages yet</h3><p>Send a message to the Summit team below.</p>
              </div>
            )}
            {visibleMessages.map(msg => (
              <div key={msg.id} className={`bub ${msg.creator?.email?.includes('summitsensorygym') ? 'them' : 'me'}`}>
                {msg.creator && <div style={{ fontSize: 11, opacity: .7, marginBottom: 3 }}>{msg.creator.name}</div>}
                <div dangerouslySetInnerHTML={{ __html: msg.body }} />
                <div className="ts">{new Date(msg.created_at).toLocaleString()}</div>
              </div>
            ))}
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
