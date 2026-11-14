import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // Der Token steht im Pfad: nie als Referrer an Stripe oder Dritte weitergeben.
    return [{ source: '/zahlung/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
