import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repository lives below another pnpm lockfile. Pinning the application
  // root keeps Turbopack's resolver, watcher, and cache scoped to ShapeShifter.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
