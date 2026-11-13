// The regression suite: tests promoted from WebProbe runs (agent: npm run promote-tests).
//
//   npm run test:regression          clean site: every test must pass (this is the CI gate)
//   npm run test:regression:buggy    all bugs on: every test should fail, which shows the
//                                    suite still catches the bugs it was written for
//
// Playwright builds and starts its own copy of the shop, with the bugs baked in at build time,
// in a separate build folder so it doesn't clash with `npm run dev`. Set BASE_URL to test a
// server you started yourself instead.

import { defineConfig } from "@playwright/test";

const bugs = process.env.NEXT_PUBLIC_BUGS ?? "none";
const port = bugs === "none" ? 3100 : 3101;

export default defineConfig({
  testDir: "tests/regression",
  timeout: 20_000,
  expect: { timeout: 3_000 },
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "test-results/results.json" }]] : "list",
  use: { baseURL: process.env.BASE_URL ?? `http://localhost:${port}` },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npx next build && npx next start -p ${port}`,
        url: `http://localhost:${port}`,
        env: { NEXT_PUBLIC_BUGS: bugs, NEXT_DIST_DIR: `.next-test-${bugs === "none" ? "clean" : "bugs"}` },
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
