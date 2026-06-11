// Wildcard proxy rewrite — /api/:path* goes to upstream.
// Next.js App Router: local route handlers in app/api/* always take precedence
// over rewrites.  Sutra must prefer the local handler and NOT mark these flows
// as "unresolved".
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' },
    ];
  },
};
module.exports = nextConfig;
