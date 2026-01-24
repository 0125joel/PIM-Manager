import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",  // Required for static hosting (Cloudflare Pages)
  images: {
    unoptimized: true, // Required for static export
  },
};

export default nextConfig;
