import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paper's optional Node canvas/jsdom adapters are unnecessary for geometry.
  // Keep its server entry native; the browser worker uses its browser mappings.
  serverExternalPackages: ["paper"],
  // This repository lives below another pnpm lockfile. Pinning the application
  // root keeps Turbopack's resolver, watcher, and cache scoped to Pathshift.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
