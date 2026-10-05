import { Component as ReactComponent, useEffect } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { SessionProvider } from 'next-auth/react';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '../styles/globals.css';

const GOOGLE_PLACES_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

// Browser errors → /api/client-error → urgent email to Bryan (lib/errorAlerts.js).
// Best effort only: reporting must never cause an error of its own.
function reportClientError(kind, error, extra = {}) {
  try {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Unknown error');
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message,
        stack: error instanceof Error ? error.stack : undefined,
        url: window.location.href,
        ...extra,
      }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

// Catches React render crashes, which otherwise blank the page with no report.
class ErrorBoundary extends ReactComponent {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    reportClientError('render crash', error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ maxWidth: 480, margin: '96px auto', padding: '0 16px', textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Something went wrong</h1>
        <p style={{ color: '#555', lineHeight: 1.6, marginBottom: 24 }}>
          Our team has been notified automatically. Please refresh the page to try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#2f5d3a', color: '#fff', fontSize: 15, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>
    );
  }
}

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  useEffect(() => {
    const onError = (e) => reportClientError('window error', e.error || e.message);
    const onRejection = (e) => reportClientError('unhandled promise rejection', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <>
      <Head>
        <link rel="icon" href="/logo.png" type="image/png" />
      </Head>
      {GOOGLE_PLACES_API_KEY && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&libraries=places&loading=async`}
          strategy="afterInteractive"
          onLoad={() => window.dispatchEvent(new Event('google-maps-loaded'))}
        />
      )}
      <SessionProvider session={session}>
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
      </SessionProvider>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
