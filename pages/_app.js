import Head from 'next/head';
import Script from 'next/script';
import { SessionProvider } from 'next-auth/react';
import '../styles/globals.css';

const GOOGLE_PLACES_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

export default function App({ Component, pageProps: { session, ...pageProps } }) {
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
        <Component {...pageProps} />
      </SessionProvider>
    </>
  );
}
