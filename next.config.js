/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
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
              // Allow any https script — covers Jotform CDN, Google Maps, YouTube player, etc.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
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
