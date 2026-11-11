import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (the clean site next to the buggy one) needs its own build folder:
  // next dev refuses to start twice on the same one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
