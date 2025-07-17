/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3001/api/v1/:path*', // Backend API
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:3001/socket.io/:path*', // Socket.IO proxy
      },
      {
        source: '/job-progress/:path*',
        destination: 'http://localhost:3001/job-progress/:path*', // WebSocket namespace proxy
      },
    ];
  },
};

export default nextConfig; 