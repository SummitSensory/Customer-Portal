/**
 * Tab: Photo & Video Showcase.
 *
 * Split out of pages/portal/index.js (2026-08-19 performance pass) and
 * loaded via next/dynamic so this tab's Jotform-embed logic isn't part of
 * the initial portal bundle — most customers never open it in a given
 * session. isValidJotformId is shared with ColorTab (still in
 * pages/portal/index.js), so it lives in lib/jotform.js rather than being
 * duplicated here.
 */
import { useState, useEffect } from 'react';
import { isValidJotformId } from '../../lib/jotform';

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

export default function ShowcaseTab({ order }) {
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const rawFormId = order?.showcaseFormId;
  const trimmedFormId = typeof rawFormId === 'string' ? rawFormId.trim() : '';
  const formId = isValidJotformId(trimmedFormId) ? trimmedFormId : '';
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
