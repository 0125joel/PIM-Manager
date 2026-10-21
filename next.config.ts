import type { NextConfig } from "next";

// Fixture routes (`src/app/dev/**/page.fixture.tsx`) are pages only in a build with NEXT_PUBLIC_FIXTURES=1; a normal build
// does not see them as routes, so neither the route nor the fixture data ships (`npm run visual`)
const withFixtures = process.env.NEXT_PUBLIC_FIXTURES === "1";

const nextConfig: NextConfig = {
  output: "export",  // Required for static hosting (Cloudflare Pages, Azure Static Web Apps, etc.)
  images: {
    unoptimized: true, // Required for static export
  },
  pageExtensions: withFixtures ? ["tsx", "ts", "jsx", "js", "fixture.tsx"] : ["tsx", "ts", "jsx", "js"],
};

export default nextConfig;
