/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // lib/errorAlerts.js only uses waitUntil, but the package root also has a
  // lazy, optional `import("ws")` that webpack warns about when bundling.
  // Loading it from node_modules at runtime avoids that; ws is never used.
  serverExternalPackages: ['@vercel/functions'],
  env: {
    // Mirrors the real, server-only STAFF_EMAIL_DOMAIN (lib/auth.js's actual
    // access-control check) so the admin Settings page displays the domain(s)
    // actually enforced, instead of a separate NEXT_PUBLIC_STAFF_DOMAIN that
    // was never set anywhere and silently showed a hardcoded fallback that
    // could drift from the real value. Not sensitive — a company's own email
    // domain(s), safe to expose client-side.
    NEXT_PUBLIC_STAFF_DOMAIN: process.env.STAFF_EMAIL_DOMAIN || 'summitsensory.com,summitsensorygym.com',
  },
  images: {
    domains: ['files-monday-com.s3.amazonaws.com', 'monday-files.s3.amazonaws.com'],
  },
  async headers() {
    return [
      {
        // Security headers for all API routes
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // X-Frame-Options removed from API routes — not applicable there
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              // Who can embed this portal in an iframe (keep specific)
              "frame-ancestors 'self' https://summitsensory.com https://www.summitsensory.com",
              // Allow any https iframe — covers Jotform, YouTube, Vimeo, invoice links, etc.
              "frame-src 'self' https:",
              // Only the hosts this app actually loads scripts from (audit
              // 2026-10-09 — `https:` let any site's script run here):
              //   cdn.jotfor.ms          Jotform embed handler (ColorTab, ShowcaseTab)
              //   *.googleapis.com,      Google Maps/Places autocomplete (_app.js) and
              //   *.gstatic.com          the scripts it pulls in, per Google's Maps CSP guide
              //   va.vercel-scripts.com  Vercel Analytics/Speed Insights (same-origin
              //                          /_vercel/* in production; this host in dev/preview)
              // 'unsafe-inline' stays: the pages router injects inline scripts
              // without nonces. 'unsafe-eval' stays: Google's Maps CSP guide still
              // lists it for the Maps JS API. Videos and forms run inside iframes,
              // which have their own policy, so they need no entry here.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jotfor.ms https://*.googleapis.com https://*.gstatic.com https://va.vercel-scripts.com",
              // Allow any https fetch/XHR — covers Jotform API, tracking APIs, etc.
              "connect-src 'self' https:",
              // Allow any https image — covers Jotform, Monday, YouTube thumbnails, etc.
              "img-src 'self' data: blob: https:",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
