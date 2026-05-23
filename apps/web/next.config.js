/** @type {import('next').NextConfig} */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000';
const nextConfig = {
  // 3Dmol.js, Leaflet, and RDKit SVG inject content via innerHTML / direct DOM
  // mutation. React StrictMode double-mounts every component in dev, which
  // makes the second mount race with the first's cleanup → 'removeChild' errors.
  // Disabling strict mode is the standard fix for apps that embed direct-DOM
  // libraries. (Has no effect in production.)
  reactStrictMode: false,
  async rewrites() {
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${API_BASE}/api/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;
