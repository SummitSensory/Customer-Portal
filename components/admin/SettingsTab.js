/**
 * Admin Settings tab — Monday.com/Jotform/FedEx integration status,
 * notifications, auth, branding, and users/access.
 *
 * Split out of pages/admin/index.js (2026-08-19 performance pass) and
 * loaded via next/dynamic — most staff sessions never open Settings, so
 * this tab's code (and the several read-only sub-panels below) shouldn't
 * be part of every admin page load. Self-contained: no dependency on
 * anything else in the admin page module.
 */
import { useState, useEffect } from 'react';

export default function SettingsTab({ showToast }) {
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
  const [mossColor, setMossColor] = useState(null);

  useEffect(() => {
    // Read the LIVE CSS variable instead of a hardcoded snapshot. The previous
    // version of this component hardcoded "#2f5d50" directly in JSX — when
    // --moss was later changed to #475569 in globals.css, this display silently
    // went stale and kept showing the old color forever. Reading it via
    // getComputedStyle means it can never drift out of sync again.
    const value = getComputedStyle(document.documentElement).getPropertyValue('--moss').trim();
    setMossColor(value || null);
  }, []);

  return (
    <div className="card">
      <div className="ch"><h3>Branding</h3></div>
      <p style={{ fontSize: 13.5, color: 'var(--mut)', marginBottom: 20 }}>Portal branding is configured in <code>styles/globals.css</code> via CSS variables.</p>
      <div className="field">
        <label>Primary Color</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--moss)', border: '2px solid var(--ink)' }} />
          <code style={{ fontSize: 12 }}>--moss: {mossColor || '…'}</code>
        </div>
        <div className="hint">Update the <code>--moss</code> variable in globals.css to change the primary brand color — this swatch always reflects the live value, it can't go stale.</div>
      </div>
      <div className="alert info" style={{ marginTop: 16 }}>
        <span>ℹ️</span>
        <span>Email templates (<code>lib/email.js</code>) currently keep their own separate, hardcoded copy of this palette — changing <code>--moss</code> here does not change the color used in emails yet. The Email Templates system will centralize this.</span>
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
