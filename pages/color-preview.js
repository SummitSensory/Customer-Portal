/**
 * /color-preview — a standing demo of the native color picker.
 *
 * Deliberately NOT under /portal — middleware.js requires a real customer
 * session cookie for anything under that path, which would make this
 * unreachable for its whole purpose (previewing before real backend/auth
 * plumbing exists for it). Living at the top level avoids needing any
 * change to shared auth middleware for a demo page.
 *
 * No login, no session, no real order, no Monday.com contact anywhere on
 * this page or its API route (pages/api/demo/color-selection.js). Exists
 * so the real, actual ColorSelectionTab component — not a mockup, not a
 * screenshot — can be clicked through before the real backend is wired to
 * a live Monday column (see colorSelectionWritable in lib/monday.js).
 *
 * Not linked from anywhere in the real customer-facing app; reachable only
 * by knowing this URL directly.
 */
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useState } from 'react';

const ColorSelectionTab = dynamic(() => import('../components/portal/ColorSelectionTab'), {
  loading: () => <div className="card"><div className="spin" style={{ width: 24, height: 24 }} /></div>,
});

const DEMO_ORDER = {
  id: 'demo',
  name: 'Preview Customer — Adventure Series',
  productType: 'Summit Adventure Series: Custom Sensory Gym',
  colorSelectionSnapshot: null,
};

export default function ColorPreviewPage() {
  const [toast, setToast] = useState('');

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  return (
    <>
      <Head>
        <title>Color Picker Preview — Not Live</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
        <div style={{
          background: 'var(--sun)', color: '#fff', padding: '10px 20px',
          fontSize: 13.5, fontWeight: 600, textAlign: 'center',
        }}>
          🚧 PREVIEW ONLY — this is a demo with fake data. Nothing here is connected to a real customer, order, or Monday.com. Nothing saved here is real.
        </div>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 80px' }}>
          <div className="card">
            <ColorSelectionTab
              order={DEMO_ORDER}
              completions={{}}
              markComplete={() => {}}
              showToast={showToast}
              onNext={() => showToast('This is where the real portal would move to the next tab (Required Documents).')}
              onBack={() => showToast('This is where the real portal would move back to the Delivery tab.')}
              apiBase="/api/demo/color-selection"
            />
          </div>
        </div>
        {toast && (
          <div className="toast show">{toast}</div>
        )}
      </div>
    </>
  );
}
