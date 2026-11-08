import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The viewer scores runs with the agent's own eval code (../agent/src/eval.ts), so the
  // bundler's root is the repo, not this folder.
  turbopack: { root: path.join(__dirname, "..") },
};

export default nextConfig;
