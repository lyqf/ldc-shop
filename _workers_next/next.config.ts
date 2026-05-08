import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config) {
    // @auth/core built-in pages depend on preact, but we use custom pages — stub them out
    config.resolve.alias = {
      ...config.resolve.alias,
      'preact/jsx-runtime': false,
      'preact-render-to-string': false,
    }
    return config
  },
  output: 'standalone',
  // Cache Components are unreliable on Workers (dummy cache + setTimeout warnings)
  cacheComponents: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    return [
      {
        source: '/authcallback',
        destination: '/api/auth/callback/linuxdo',
      },
      {
        source: '/favicon.ico',
        destination: '/favicon',
      },
    ]
  },
};

export default nextConfig;
