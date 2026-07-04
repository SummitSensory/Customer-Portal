/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
              // Who can embed this portal in an iframe
              "frame-ancestors 'self' https://summitsensory.com https://www.summitsensory.com",
              // Allow Jotform iframes to load inside the portal
              "frame-src 'self' https://form.jotform.com https://*.jotfor.ms",
              // Allow Jotform scripts and CDN assets
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jotfor.ms https://*.jotfor.ms",
              // Allow Jotform API calls and CDN connections
              "connect-src 'self' https://api.jotform.com https://cdn.jotfor.ms https://*.jotfor.ms",
              // Allow images from Jotform and Monday
              "img-src 'self' data: https://*.jotfor.ms https://files-monday-com.s3.amazonaws.com https://monday-files.s3.amazonaws.com",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
