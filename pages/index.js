/**
 * Landing page — two login paths:
 *  1. Staff: Microsoft 365 SSO  → /admin
 *  2. Customer: email + 6-digit code  → /portal
 */

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Landing() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState(null); // null | 'customer'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Redirect staff who are already signed in
  useEffect(() => {
    if (status === 'authenticated') router.replace('/admin');
  }, [status, router]);

  // Check for existing customer session
  useEffect(() => {
    fetch('/api/auth/session-check')
      .then(r => r.json())
      .then(d => { if (d.ok) router.replace('/portal'); })
      .catch(() => {});
  }, [router]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleSendCode(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code.');
      setStep('code');
      showToast('Check your email for a 6-digit code.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code.');
      router.replace('/portal');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading') return null;

  return (
    <>
      <Head>
        <title>Summit Sensory Gym — Portal</title>
      </Head>

      <div className="sl-root">
        {/* ── Left brand panel ── */}
        <div className="sl-brand">
          <div className="sl-brand-inner">
            {/* Logo mark */}
            <div className="sl-logo-wrap">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="44" height="44" rx="12" fill="rgba(255,255,255,0.15)" />
                <path d="M22 10L34 28H10L22 10Z" fill="white" opacity="0.9" />
                <path d="M15 28L22 18L29 28" fill="white" opacity="0.5" />
                <rect x="10" y="29" width="24" height="3" rx="1.5" fill="white" opacity="0.6" />
              </svg>
              <span className="sl-wordmark">Summit Sensory Gym</span>
            </div>

            {/* Headline */}
            <div className="sl-hero">
              <h1 className="sl-h1">Your order,<br />all in one place.</h1>
              <p className="sl-sub">
                Track your project, complete required forms, access documents, and connect with our team — from a single secure portal.
              </p>
            </div>

            {/* Feature list */}
            <ul className="sl-features">
              {[
                { icon: '📦', text: 'Real-time order & shipping status' },
                { icon: '📋', text: 'Complete setup forms and color selections' },
                { icon: '📁', text: 'Access invoices and project documents' },
                { icon: '💬', text: 'Message the Summit team directly' },
              ].map(f => (
                <li key={f.text} className="sl-feat">
                  <span className="sl-feat-ic">{f.icon}</span>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>

            {/* Footer */}
            <p className="sl-copy">© {new Date().getFullYear()} Summit Sensory Gym · Denver, CO</p>
          </div>
        </div>

        {/* ── Right login panel ── */}
        <div className="sl-right">
          <div className="sl-form-wrap">

            {!mode ? (
              /* ── Mode selector ── */
              <div className="sl-choose">
                <div className="sl-choose-head">
                  <h2 className="sl-choose-title">Welcome back</h2>
                  <p className="sl-choose-sub">Select how you'd like to sign in.</p>
                </div>

                {/* Customer */}
                <button className="sl-option" onClick={() => setMode('customer')}>
                  <div className="sl-opt-ic" style={{ background: 'var(--sky-lt)', color: 'var(--sky)' }}>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="8" r="4" fill="currentColor" opacity=".8"/><path d="M3 19c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </div>
                  <div className="sl-opt-body">
                    <span className="sl-opt-title">Customer Portal</span>
                    <span className="sl-opt-desc">Track your order and complete setup</span>
                  </div>
                  <span className="sl-opt-arrow">→</span>
                </button>

                {/* Divider */}
                <div className="sl-div">
                  <span>or</span>
                </div>

                {/* Staff */}
                <button
                  className="sl-option sl-option-staff"
                  onClick={() => signIn('azure-ad', { callbackUrl: '/admin' })}
                >
                  <div className="sl-opt-ic" style={{ background: 'var(--moss-lt)', color: 'var(--moss)' }}>
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="12" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="3" y="12" width="7" height="7" rx="1.5" fill="currentColor" opacity=".6"/><rect x="12" y="12" width="7" height="7" rx="1.5" fill="currentColor"/></svg>
                  </div>
                  <div className="sl-opt-body">
                    <span className="sl-opt-title">Staff Portal</span>
                    <span className="sl-opt-desc">Sign in with Microsoft 365</span>
                  </div>
                  <span className="sl-opt-arrow">→</span>
                </button>

                <p className="sl-note">Staff access is restricted to @summitsensorygym.com accounts.</p>
              </div>

            ) : (
              /* ── Customer auth flow ── */
              <div className="sl-auth">
                <button
                  className="sl-back"
                  onClick={() => { setMode(null); setStep('email'); setError(''); setEmail(''); setCode(''); }}
                >
                  ← Back
                </button>

                {step === 'email' ? (
                  <>
                    <div className="sl-auth-head">
                      <div className="sl-auth-ic">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M2 8l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                      </div>
                      <h2 className="sl-auth-title">Customer sign in</h2>
                      <p className="sl-auth-sub">Enter the email address on your Summit Sensory Gym order and we'll send you a secure login code.</p>
                    </div>

                    <form onSubmit={handleSendCode} className="sl-form">
                      <div className="field">
                        <label>Email address</label>
                        <input
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@yourclinic.com"
                          required
                          autoFocus
                        />
                      </div>
                      {error && <div className="alert err">{error}</div>}
                      <button className="btn btn-moss sl-submit" disabled={loading}>
                        {loading ? (
                          <><span className="spin" style={{ width: 16, height: 16, borderWidth: 2 }} /> Sending…</>
                        ) : 'Send Login Code'}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="sl-auth-head">
                      <div className="sl-auth-ic" style={{ background: 'var(--ok-lt)', color: 'var(--ok)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="7" y="11" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M9 11V7a3 3 0 016 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="15.5" r="1.5" fill="currentColor"/></svg>
                      </div>
                      <h2 className="sl-auth-title">Enter your code</h2>
                      <p className="sl-auth-sub">We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>
                    </div>

                    <form onSubmit={handleVerifyCode} className="sl-form">
                      <div className="field">
                        <label>6-digit code</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={code}
                          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="000000"
                          required
                          autoFocus
                          style={{ fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: 600 }}
                        />
                      </div>
                      {error && <div className="alert err">{error}</div>}
                      <button className="btn btn-moss sl-submit" disabled={loading}>
                        {loading ? (
                          <><span className="spin" style={{ width: 16, height: 16, borderWidth: 2 }} /> Verifying…</>
                        ) : 'Access My Portal'}
                      </button>
                    </form>

                    <p className="sl-resend">
                      Didn't receive it?{' '}
                      <button onClick={() => { setStep('email'); setCode(''); setError(''); }}>
                        Try a different email
                      </button>
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
