// Checks which visual tests failed in test-results/results.json, for CI.
//
//   node scripts/check-visual.mjs desktop/home mobile/home   exactly these failed
//   node scripts/check-visual.mjs mobile/*                   exactly the mobile tests failed
//
// A name is <project>/<first word of the test title>; "<project>/*" means every test in it.

import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("test-results/results.json", "utf8"));
const walk = (s) => [...(s.specs ?? []), ...(s.suites ?? []).flatMap(walk)];
const results = report.suites.flatMap(walk).flatMap((spec) =>
  spec.tests.map((t) => ({
    name: `${t.projectName}/${spec.title.split(" ")[0]}`,
    failed: t.results.at(-1)?.status !== "passed",
  })),
);

const want = new Set(
  process.argv.slice(2).flatMap((arg) =>
    arg.endsWith("/*") ? results.filter((r) => r.name.startsWith(arg.slice(0, -1))).map((r) => r.name) : [arg],
  ),
);
const failed = results.filter((r) => r.failed).map((r) => r.name).sort();
console.log("expected to fail:", [...want].sort().join(", "));
console.log("failed:          ", failed.join(", ") || "(none)");
if (failed.length !== want.size || failed.some((f) => !want.has(f))) process.exit(1);
console.log("as expected");
