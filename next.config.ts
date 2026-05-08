import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Large card imports (JSONL / text files) via Server Actions FormData.
    serverActions: {
      bodySizeLimit: '64mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/authcallback',
        destination: '/api/auth/callback/linuxdo',
      },
    ]
  },
};

export default nextConfig;
