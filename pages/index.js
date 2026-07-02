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

      <div id="landing">
        <div className="land-wrap">
          <div className="land-head">
            <div className="brand">
              <div className="logo" />
              <b>Summit Sensory Gym</b>
            </div>
            <h1>Your order,<br />all in one place.</h1>
            <p>Track your project, complete required forms, access files, and message our team — all from one secure portal.</p>
          </div>

          {!mode ? (
            <div className="cards">
              {/* Customer Card */}
              <div className="lcard">
                <div className="ic" style={{ background: 'var(--sky-lt)', color: 'var(--sky)' }}>👤</div>
                <h3>Customer Portal</h3>
                <p>Track your order, complete required forms, and connect with the Summit team.</p>
                <button className="btn btn-moss" style={{ width: '100%' }} onClick={() => setMode('customer')}>
                  Sign in as Customer
                </button>
                <p className="note">Enter your email to receive a secure login code.</p>
              </div>

              {/* Staff Card */}
              <div className="lcard">
                <div className="ic" style={{ background: 'var(--moss-lt)', color: 'var(--moss)' }}>🏢</div>
                <h3>Staff Portal</h3>
                <p>Manage orders, share files, update status, and communicate with customers.</p>
                <button
                  className="btn btn-ms"
                  style={{ width: '100%' }}
                  onClick={() => signIn('azure-ad', { callbackUrl: '/admin' })}
                >
                  <span className="ms-logo">
                    <i style={{ background: '#f25022' }} />
                    <i style={{ background: '#7fba00' }} />
                    <i style={{ background: '#00a4ef' }} />
                    <i style={{ background: '#ffb900' }} />
                  </span>
                  Sign in with Microsoft
                </button>
                <p className="note">For Summit Sensory Gym team members only.</p>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 420, margin: '0 auto' }}>
              <div className="lcard">
                <button
                  onClick={() => { setMode(null); setStep('email'); setError(''); }}
                  style={{ color: 'var(--mut)', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  ← Back
                </button>

                {step === 'email' ? (
                  <>
                    <h3 style={{ marginBottom: 6 }}>Customer Login</h3>
                    <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>
                      Enter the email address associated with your Summit Sensory Gym order.
                    </p>
                    <form onSubmit={handleSendCode}>
                      <div className="field">
                        <label>Email address</label>
                        <input
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          required
                          autoFocus
                        />
                      </div>
                      {error && <div className="alert err" style={{ marginBottom: 12 }}>{error}</div>}
                      <button className="btn btn-moss" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Sending…' : 'Send Login Code'}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <h3 style={{ marginBottom: 6 }}>Enter Your Code</h3>
                    <p style={{ color: 'var(--mut)', fontSize: 13.5, marginBottom: 20 }}>
                      We sent a 6-digit code to <strong>{email}</strong>.
                    </p>
                    <form onSubmit={handleVerifyCode}>
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
                          style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }}
                        />
                      </div>
                      {error && <div className="alert err" style={{ marginBottom: 12 }}>{error}</div>}
                      <button className="btn btn-moss" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Verifying…' : 'Access My Portal'}
                      </button>
                    </form>
                    <p className="note" style={{ marginTop: 12 }}>
                      Didn't receive it?{' '}
                      <button onClick={() => { setStep('email'); setCode(''); setError(''); }} style={{ color: 'var(--sky)', fontWeight: 600, fontSize: 12 }}>
                        Try again
                      </button>
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          <p className="foot">
            © {new Date().getFullYear()} Summit Sensory Gym · Denver, CO
          </p>
        </div>
      </div>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
