import Head from 'next/head';
import { SessionProvider } from 'next-auth/react';
import '../styles/globals.css';

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <>
      <Head>
        <link rel="icon" href="/logo.png" type="image/png" />
      </Head>
      <SessionProvider session={session}>
        <Component {...pageProps} />
      </SessionProvider>
    </>
  );
}
