/**
 * Tab: Refer a Friend.
 *
 * Split out of pages/portal/index.js (2026-08-19 performance pass) and
 * loaded via next/dynamic so this tab's code — and the referral copy baked
 * into it — isn't part of the initial portal bundle. Most customers never
 * open this tab in a given session, so it costs nothing until they do.
 * Self-contained: no dependency on anything else in the portal page module.
 */
import { useState } from 'react';

export default function ReferralTab({ order, showToast }) {
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
