/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'https://sova-intel.duckdns.org/api/v1*',
      },
    ];
  },
};

export default nextConfig; 