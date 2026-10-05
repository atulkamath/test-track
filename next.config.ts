import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Never ship source maps to the browser: players see minified code, not the source.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
