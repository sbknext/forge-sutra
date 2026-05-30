/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:9999/api/:path*',
      },
      {
        source: '/auth/:path*',
        destination: 'http://localhost:9999/auth/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
