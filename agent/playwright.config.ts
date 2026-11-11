// Runs the regression tests that gen-tests writes into runs/<id>/tests/.
// BASE_URL picks the site: the buggy one (tests should fail) or the clean one (they should pass).

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "runs",
  testMatch: "**/tests/*.spec.ts",
  timeout: 20_000,
  expect: { timeout: 3_000 },
  retries: 0,
  workers: 1,
  reporter: "line",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000" },
});
