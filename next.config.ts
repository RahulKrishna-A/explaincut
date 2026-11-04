import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Native/binary Node packages used directly by API routes - Turbopack can't
  // statically bundle their non-JS assets (native binaries), so they must
  // stay external requires at runtime. Remotion itself is invoked as a CLI
  // subprocess (see lib/render/renderDiagramLayer.ts), so it never needs to
  // be bundled by Next.js at all.
  serverExternalPackages: ["sharp", "ffmpeg-static"],
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
