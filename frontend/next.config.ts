import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end suite drives the dev server over 127.0.0.1 rather than localhost, which
  // Next treats as a cross-origin dev host and blocks from fetching /_next resources.
  // Dev-only; it has no effect on a production build.
  allowedDevOrigins: ["127.0.0.1"],

  // Set only by the end-to-end harness (see playwright.config.ts). It moves every route and
  // asset under one prefix so the test server can reverse-proxy the whole app from the origin
  // the extension manifest already trusts.
  //
  // Why that is necessary: `chrome.scripting.executeScript` needs either `activeTab` — granted
  // when a user clicks the toolbar button, which no automation API can simulate — or a matching
  // `host_permissions` entry. FormPilot deliberately declares neither for arbitrary origins, so
  // a Next server on its own port is unreachable from the harness. Proxying it through the
  // trusted origin tests the same thing (real server rendering, real hydration, real controlled
  // inputs) without adding a test-only origin to the shipped manifest.
  basePath: process.env.FORMPILOT_E2E_BASE_PATH || undefined,
};

export default nextConfig;
