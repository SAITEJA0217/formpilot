import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end suite drives the dev server over 127.0.0.1 rather than localhost, which
  // Next treats as a cross-origin dev host and blocks from fetching /_next resources.
  // Dev-only; it has no effect on a production build.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
