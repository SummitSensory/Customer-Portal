import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* PORTAL-056: this app has real, deliberate responsive CSS (see
            styles/globals.css's "Responsive" section — a mobile nav drawer,
            larger touch targets, breakpoints at 900/820/560px) but NO
            viewport meta tag anywhere in the app. Without it, mobile
            browsers render the page assuming a ~980px desktop-width layout
            viewport and scale the whole thing down to fit the screen —
            every one of those max-width media queries silently never
            matches on a real phone, since the viewport they check against
            was never the device's actual width. This single tag is what
            makes all of that already-built responsive work actually run. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="description" content="Summit Sensory Gym Customer Portal" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
