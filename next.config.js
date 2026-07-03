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
        // Allow the portal pages to be embedded from summitsensory.com only.
        // Change the Content-Security-Policy frame-ancestors value if your
        // website domain differs.
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            // ALLOW-FROM is deprecated; CSP frame-ancestors is the modern replacement
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            // Allows embedding from summitsensory.com and www.summitsensory.com.
            // 'self' covers portal.summitsensory.com itself (e.g. admin iframes).
            value: "frame-ancestors 'self' https://summitsensory.com https://www.summitsensory.com",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
