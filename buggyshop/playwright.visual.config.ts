// Visual regression suite: screenshots of the main pages, compared with committed baselines.
//
//   npm run test:visual            compare with the baselines (clean site)
//   npm run test:visual:update     write new baselines after an intended change
//
// Rendering differs between operating systems (fonts, anti-aliasing), so baselines are kept per
// platform. The committed ones are Linux, made in the same Playwright container CI uses; on a
// Mac, run test:visual:update once to make local ones (they are gitignored).

import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}",
  expect: {
    ...base.expect,
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixels: 30 },
  },
  use: { ...base.use, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
});
