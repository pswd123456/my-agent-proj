import type { NextConfig } from "next";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (/^https?:\/\//.test(apiBaseUrl)) {
      return [
        {
          source: "/api/:path*",
          destination: `${apiBaseUrl}/:path*`
        }
      ];
    }

    return [];
  }
};

export default nextConfig;
