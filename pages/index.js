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

  useEffect(() => {
    if (status === 'authenticated') router.replace('/admin');
  }, [status, router]);

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
        <title>Summit Sensory Gym — Customer Portal</title>
      </Head>

      {/* Page background */}
      <div style={{
        minHeight: '100vh',
        background: '#E2E3E5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        fontFamily: "'Archivo', sans-serif",
      }}>

        {/* Floating card */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          width: '100%',
          maxWidth: 960,
          minHeight: 580,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 8px 48px rgba(0,0,0,.18)',
        }}>

          {/* ── LEFT: White login panel ── */}
          <div style={{
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '52px 48px',
          }}>

            {!mode ? (
              /* Mode selector */
              <div>
                <h2 style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#111',
                  marginBottom: 6,
                  letterSpacing: '-0.01em',
                }}>
                  Welcome Back
                </h2>
                <p style={{ fontSize: 14, color: '#777', marginBottom: 32 }}>
                  Select how you'd like to sign in.
                </p>

                {/* Customer option */}
                <button
                  onClick={() => setMode('customer')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    width: '100%',
                    background: '#fff',
                    border: '1.5px solid #E0E0E0',
                    borderRadius: 14,
                    padding: '18px 20px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    marginBottom: 12,
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#1B2D6B'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(27,45,107,.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#E0E0E0'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: '#EEF1F9', color: '#1B2D6B',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, flexShrink: 0,
                  }}>👤</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>Customer Portal</div>
                    <div style={{ fontSize: 12.5, color: '#888', marginTop: 2 }}>Track your order and complete setup</div>
                  </div>
                  <span style={{ color: '#aaa', fontSize: 18 }}>→</span>
                </button>

                {/* Divider */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  margin: '8px 0', color: '#bbb', fontSize: 12.5,
                }}>
                  <div style={{ flex: 1, height: 1, background: '#EEE' }} />
                  <span>or</span>
                  <div style={{ flex: 1, height: 1, background: '#EEE' }} />
                </div>

                {/* Staff option */}
                <button
                  onClick={() => signIn('azure-ad', { callbackUrl: '/admin' })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    width: '100%',
                    background: '#fff',
                    border: '1.5px solid #E0E0E0',
                    borderRadius: 14,
                    padding: '18px 20px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    marginBottom: 12,
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#1B2D6B'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(27,45,107,.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#E0E0E0'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: '#EEF6F1', color: '#1E6641',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {/* Microsoft grid logo */}
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                      <rect x="12" y="1" width="9" height="9" fill="#7fba00"/>
                      <rect x="1" y="12" width="9" height="9" fill="#00a4ef"/>
                      <rect x="12" y="12" width="9" height="9" fill="#ffb900"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>Staff Portal</div>
                    <div style={{ fontSize: 12.5, color: '#888', marginTop: 2 }}>Sign in with Microsoft 365</div>
                  </div>
                  <span style={{ color: '#aaa', fontSize: 18 }}>→</span>
                </button>

                <p style={{ fontSize: 11.5, color: '#aaa', textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
                  Staff access is restricted to @summitsensorygym.com accounts.
                </p>
              </div>

            ) : (
              /* Customer auth flow */
              <div>
                <button
                  onClick={() => { setMode(null); setStep('email'); setError(''); setEmail(''); setCode(''); }}
                  style={{ color: '#999', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 28 }}
                >
                  ← Back
                </button>

                {step === 'email' ? (
                  <>
                    <div style={{
                      width: 50, height: 50, borderRadius: 13,
                      background: '#EEF1F9', color: '#1B2D6B',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 18,
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.8"/>
                        <path d="M2 8l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, color: '#111', marginBottom: 8, letterSpacing: '-0.01em' }}>
                      Customer Sign In
                    </h2>
                    <p style={{ fontSize: 13.5, color: '#777', marginBottom: 28, lineHeight: 1.55 }}>
                      Enter the email address on your Summit Sensory Gym order and we'll send a secure login code.
                    </p>
                    <form onSubmit={handleSendCode}>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: '#444' }}>
                          Email address
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@yourclinic.com"
                          required
                          autoFocus
                          style={{
                            width: '100%', padding: '11px 14px', fontSize: 14,
                            border: '1.5px solid #E0E0E0', borderRadius: 10,
                            fontFamily: 'inherit', color: '#111', background: '#fff',
                            outline: 'none', transition: 'border-color .15s',
                          }}
                          onFocus={e => e.target.style.borderColor = '#1B2D6B'}
                          onBlur={e => e.target.style.borderColor = '#E0E0E0'}
                        />
                      </div>
                      {error && (
                        <div style={{ background: '#FFF0F0', border: '1px solid #FFC5C5', color: '#8B1A1A', borderRadius: 9, padding: '11px 14px', fontSize: 13.5, marginBottom: 14 }}>
                          {error}
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={loading}
                        style={{
                          width: '100%', padding: '13px 18px',
                          background: '#1B2D6B', color: '#fff',
                          fontWeight: 700, fontSize: 14.5,
                          border: 'none', borderRadius: 11, cursor: loading ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          opacity: loading ? 0.65 : 1, transition: 'background .15s',
                        }}
                      >
                        {loading ? 'Sending…' : 'Send Login Code'}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: 50, height: 50, borderRadius: 13,
                      background: '#E8F5EE', color: '#1E6641',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 18,
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <rect x="7" y="11" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                        <path d="M9 11V7a3 3 0 016 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        <circle cx="12" cy="15.5" r="1.5" fill="currentColor"/>
                      </svg>
                    </div>
                    <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, color: '#111', marginBottom: 8, letterSpacing: '-0.01em' }}>
                      Enter Your Code
                    </h2>
                    <p style={{ fontSize: 13.5, color: '#777', marginBottom: 28, lineHeight: 1.55 }}>
                      We sent a 6-digit code to <strong style={{ color: '#333' }}>{email}</strong>. It expires in 10 minutes.
                    </p>
                    <form onSubmit={handleVerifyCode}>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: '#444' }}>
                          6-digit code
                        </label>
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
                          style={{
                            width: '100%', padding: '13px 14px',
                            fontSize: 30, letterSpacing: 10, textAlign: 'center', fontWeight: 700,
                            border: '1.5px solid #E0E0E0', borderRadius: 10,
                            fontFamily: 'inherit', color: '#111', background: '#fff',
                            outline: 'none', transition: 'border-color .15s',
                          }}
                          onFocus={e => e.target.style.borderColor = '#1B2D6B'}
                          onBlur={e => e.target.style.borderColor = '#E0E0E0'}
                        />
                      </div>
                      {error && (
                        <div style={{ background: '#FFF0F0', border: '1px solid #FFC5C5', color: '#8B1A1A', borderRadius: 9, padding: '11px 14px', fontSize: 13.5, marginBottom: 14 }}>
                          {error}
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={loading}
                        style={{
                          width: '100%', padding: '13px 18px',
                          background: '#1B2D6B', color: '#fff',
                          fontWeight: 700, fontSize: 14.5,
                          border: 'none', borderRadius: 11, cursor: loading ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          opacity: loading ? 0.65 : 1,
                        }}
                      >
                        {loading ? 'Verifying…' : 'Access My Portal'}
                      </button>
                    </form>
                    <p style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: '#aaa' }}>
                      Didn't receive it?{' '}
                      <button
                        onClick={() => { setStep('email'); setCode(''); setError(''); }}
                        style={{ color: '#1B2D6B', fontWeight: 600, fontSize: 13 }}
                      >
                        Try again
                      </button>
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Bottom copyright */}
            <p style={{ fontSize: 11.5, color: '#ccc', marginTop: 'auto', paddingTop: 32, textAlign: 'center' }}>
              © {new Date().getFullYear()} Summit Sensory Gym · Denver, CO
            </p>
          </div>

          {/* ── RIGHT: Brand panel ── */}
          <div style={{
            background: 'linear-gradient(155deg, #0F1D52 0%, #1B2D6B 45%, #162459 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '52px 44px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>

            {/* Decorative circles */}
            <div style={{
              position: 'absolute', width: 400, height: 400, borderRadius: '50%',
              background: 'rgba(255,255,255,.03)',
              top: -120, right: -120,
            }} />
            <div style={{
              position: 'absolute', width: 260, height: 260, borderRadius: '50%',
              background: 'rgba(255,255,255,.03)',
              bottom: -60, left: -60,
            }} />

            {/* Content */}
            <div style={{ position: 'relative', zIndex: 1, maxWidth: 340 }}>

              {/* Logo */}
              <img
                src="/logo.png"
                alt="Summit Sensory Gym"
                style={{ width: 110, height: 110, objectFit: 'contain', marginBottom: 28 }}
              />

              {/* Headline */}
              <h1 style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 28,
                fontWeight: 700,
                color: '#fff',
                lineHeight: 1.2,
                marginBottom: 14,
                letterSpacing: '-0.01em',
              }}>
                Your Order,<br />All In One Place.
              </h1>

              {/* Subtext */}
              <p style={{
                fontSize: 13.5,
                color: 'rgba(255,255,255,.68)',
                lineHeight: 1.65,
                marginBottom: 32,
              }}>
                Track your project, complete required forms, access documents, and connect with our team — from a single secure portal.
              </p>

              {/* Feature list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                {[
                  { icon: '📦', text: 'Real-time order & shipping status' },
                  { icon: '📋', text: 'Complete setup forms and color selections' },
                  { icon: '📁', text: 'Access invoices and project documents' },
                  { icon: '💬', text: 'Message the Summit team directly' },
                ].map(f => (
                  <div key={f.text} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'rgba(255,255,255,.08)',
                    borderRadius: 11,
                    padding: '11px 16px',
                    width: '100%',
                    textAlign: 'left',
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{f.icon}</span>
                    <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,.88)', fontWeight: 500 }}>{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
