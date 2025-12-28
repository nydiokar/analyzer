import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            // Strict-Transport-Security: Force HTTPS for 1 year
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            // X-Frame-Options: Prevent clickjacking
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // X-Content-Type-Options: Prevent MIME sniffing
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // X-XSS-Protection: Enable browser XSS filter
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Referrer-Policy: Control referrer information
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Permissions-Policy: Disable unnecessary browser features
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            // Content-Security-Policy: Prevent XSS attacks
            // Note: 'unsafe-inline' and 'unsafe-eval' needed for Next.js
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://sova-intel.duckdns.org wss://sova-intel.duckdns.org",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
