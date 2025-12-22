import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Set outputFileTracingRoot to silence warning about multiple lockfiles
  outputFileTracingRoot: __dirname,
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },
  async rewrites() {
    // Backend URL can be configured via BACKEND_REWRITE_URL env variable
    // Supports both localhost and Yggdrasil IPv6 addresses
    // Example for Yggdrasil: BACKEND_REWRITE_URL=http://[200:1234:5678:9abc:def0:1234:5678:9abc]:3001
    const backendUrl = process.env.BACKEND_REWRITE_URL || 'http://localhost:3001';

    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`, // Backend API
      },

    ];
  },
};

export default nextConfig; 