// Turn each bug a run filed into a Playwright regression test, and keep only tests that work.
//
//   npm run gen-tests -- runs/<id>            (writes runs/<id>/tests/bug-<n>.spec.ts)
//
// A regression test is only useful if it catches the bug and nothing else. While writing, the
// model only gets what a real team would have: the buggy site (BUGGY_URL, default :3000). Its
// test must fail there, and the model reads the failure and either confirms it is the bug or
// fixes a broken test (up to MAX_ATTEMPTS writes). Then the clean site (CLEAN_URL, default :3002,
// `npm run dev:clean-side` in buggyshop) judges it once, with no feedback: a valid test passes
// there. The model sees the bug report and what the agent did, never the manifest.
//
// Model: WEBPROBE_PROVIDER / WEBPROBE_MODEL as for runs; defaults to claude-haiku-5-5.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS, type ProviderName } from "./agent.js";
import type { ToolDef, ToolUse, Usage } from "./providers/types.js";
import type { BugReport } from "./tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(here, "..");
const BUGGY_URL = process.env.BUGGY_URL ?? "http://localhost:3000";
const CLEAN_URL = process.env.CLEAN_URL ?? "http://localhost:3002";
const MAX_ATTEMPTS = 3;

type ToolCall = { step: number; name: string; input: Record<string, unknown>; isError: boolean; output: string };
type Report = { target: string; bugs: BugReport[]; toolCalls: ToolCall[] };

export type TestResult = {
  bug: number;
  title: string;
  file?: string;
  // valid: fails on the buggy site, passes on the clean one.
  // fails-on-clean can also mean the bug is real but not seeded, so the clean site has it too.
  status: "valid" | "passes-on-buggy" | "fails-on-clean" | "no-test";
  attempts: number;
};

const SYSTEM = `You write Playwright regression tests (TypeScript, @playwright/test) for bugs a QA agent found in a web app.

A good regression test fails while the bug is present and passes once it is fixed. So assert the expected, correct behavior from the report, and only that: nothing unrelated to the bug.

- Use relative URLs (page.goto("/cart")); the base URL is configured.
- Every test starts in a fresh browser: empty storage, empty cart, not signed in. Build any state the bug needs through the UI, as the agent did.
- Prefer getByRole, getByLabel and getByText with the names shown in the snapshots. Use exact names where text could match more than one element.
- Assert what the user sees (URL, headings, text, values), not network traffic: links in single-page apps often navigate without loading a new document. For console errors, listen for "pageerror" before acting and assert none occurred. For a failed request, assert on the message the user should see.
- You have only seen the broken app. The fixed one may differ in more than the bug: an item may disappear instead of showing 0, a price may read "Free" instead of "$0.00", a link may point somewhere else. Assert the outcome the report's "expected" field describes, as loosely as it allows, and never assert details you only saw in the broken app (its URLs, its error text, elements that exist only because of the bug).
- Keep it to one test() with a descriptive title. No retries, no fixed sleeps.

Return the file with write_test. It will be run against the current build, which has the bug, and you will see the result.`;

const writeTest: ToolDef = {
  name: "write_test",
  description: "Submit the complete .spec.ts file.",
  schema: {
    type: "object",
    properties: { code: { type: "string", description: "The whole test file, starting with the import." } },
    required: ["code"],
    additionalProperties: false,
  },
  strict: true,
};

const confirmFailure: ToolDef = {
  name: "confirm_failure",
  description: "The test's failure on the buggy build is the reported bug, not a broken test.",
  schema: {
    type: "object",
    properties: { reason: { type: "string", description: "Which assertion failed and why that is the bug." } },
    required: ["reason"],
    additionalProperties: false,
  },
  strict: true,
};

// "click e15" means nothing to a test; the snapshot before it says e15 is button "Price: low to high".
function describeActions(calls: ToolCall[]): string[] {
  const names = new Map<string, string>();
  const lines: string[] = [];
  for (const c of calls) {
    if (c.name === "snapshot") {
      for (const m of c.output.matchAll(/- (?:'|")?([a-z]+)(?: "((?:[^"\\]|\\.)*)")?[^\n]*\[ref=([\w-]+)\]/g)) {
        names.set(m[3], m[2] ? `${m[1]} "${m[2]}"` : m[1]);
      }
      continue;
    }
    const ref = String(c.input.ref ?? "");
    if (c.name === "navigate") lines.push(`navigate ${c.input.url}`);
    else if (c.name === "click") lines.push(`click ${names.get(ref) ?? ref}${c.isError ? " (failed)" : ""}`);
    else if (c.name === "type") lines.push(`type ${JSON.stringify(c.input.text)} into ${names.get(ref) ?? ref}`);
    else if (c.name === "report_bug") lines.push(`report_bug "${c.input.title}"`);
    else if (c.name === "console_errors" || c.name === "network_errors") lines.push(`${c.name} → ${c.output.split("\n").slice(0, 3).join(" | ")}`);
  }
  return lines;
}

// The latest snapshot of each page the agent saw, so the model can use the real element names.
function snapshotsByPage(calls: ToolCall[], target: string): Map<string, string> {
  const pages = new Map<string, string>();
  for (const c of calls) {
    const m = c.name === "snapshot" ? c.output.match(/^URL: (\S+)/) : null;
    if (!m) continue;
    try {
      const u = new URL(m[1]);
      if (u.origin === new URL(target).origin) pages.set(u.pathname, c.output);
    } catch {}
  }
  return pages;
}

function promptFor(bug: BugReport, actions: string[], snapshots: Map<string, string>): string {
  const snaps = [...snapshots.entries()]
    .map(([page, snap]) => `### ${page}\n${snap.length > 4000 ? snap.slice(0, 4000) + "\n…" : snap}`)
    .join("\n\n");
  return `Write a regression test for this bug.

## Bug report
${JSON.stringify(bug, null, 2)}

## What the agent did before filing it
${actions.slice(-60).join("\n")}

## Latest snapshot of each page it visited
${snaps}`;
}

function runTest(file: string, baseUrl: string): { passed: boolean; output: string } {
  const res = spawnSync("npx", ["playwright", "test", path.relative(AGENT_DIR, file)], {
    cwd: AGENT_DIR,
    env: { ...process.env, BASE_URL: baseUrl },
    encoding: "utf8",
  });
  const output = `${res.stdout}\n${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { passed: res.status === 0, output: output.trim().slice(-2500) };
}

async function main() {
  const runDir = process.argv[2];
  if (!runDir || !existsSync(path.join(runDir, "report.json"))) {
    console.error("usage: npm run gen-tests -- runs/<id>");
    process.exit(1);
  }
  for (const url of [BUGGY_URL, CLEAN_URL]) {
    if (!(await fetch(url).then((r) => r.ok).catch(() => false))) {
      console.error(`${url} is not up. Buggy site: npm run dev in buggyshop; clean: npm run dev:clean-side.`);
      process.exit(1);
    }
  }

  const report: Report = JSON.parse(readFileSync(path.join(runDir, "report.json"), "utf8"));
  const testsDir = path.join(runDir, "tests");
  mkdirSync(testsDir, { recursive: true });
  const provider = (process.env.WEBPROBE_PROVIDER ?? "claude") as ProviderName;
  const modelName = process.env.WEBPROBE_MODEL || (provider === "claude" ? "claude-haiku-5-5" : undefined);

  // The n-th successful report_bug call filed bugs[n].
  const reportAt = report.toolCalls.flatMap((c, i) => (c.name === "report_bug" && !c.isError ? [i] : []));
  const usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let price: Usage = usage;
  const results: TestResult[] = [];

  for (const [i, bug] of report.bugs.entries()) {
    const n = i + 1;
    const before = report.toolCalls.slice(0, reportAt[i] ?? report.toolCalls.length);
    const model = PROVIDERS[provider]({
      model: modelName,
      system: SYSTEM,
      firstMessage: promptFor(bug, describeActions(before), snapshotsByPage(before, report.target)),
      tools: [writeTest, confirmFailure],
      effort: "medium",
    });
    price = model.price;
    const file = path.join(testsDir, `bug-${n}.spec.ts`);
    const result: TestResult = { bug: n, title: bug.title, status: "no-test", attempts: 0 };

    let confirmed = false;
    while (result.attempts < MAX_ATTEMPTS && !confirmed) {
      const turn = await model.next();
      for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += turn.usage[k];
      const confirm = turn.toolUses.find((u) => u.name === "confirm_failure");
      const use = turn.toolUses.find((u) => u.name === "write_test");
      // Every tool call needs an answer; only one per turn is acted on.
      const others = (picked: ToolUse) =>
        turn.toolUses.filter((u) => u !== picked).map((u) => ({ use: u, output: "Ignored: one call per turn.", isError: true }));
      if (confirm && result.file) {
        confirmed = true;
        model.addResults([{ use: confirm, output: "Noted.", isError: false }, ...others(confirm)], []);
        break;
      }
      if (!use) break;
      result.attempts++;
      writeFileSync(file, String(use.input.code));
      result.file = path.basename(file);

      const buggy = runTest(file, BUGGY_URL);
      result.status = buggy.passed ? "passes-on-buggy" : "fails-on-clean"; // until the clean site says otherwise
      const feedback = buggy.passed
        ? `The test PASSED on the current build, which has the bug, so it does not catch it. Assert the behavior the report says is wrong.\n\n${buggy.output}`
        : `The test failed on the current build, which has the bug. If it failed at an assertion about the reported bug, call confirm_failure. If it broke before reaching the bug (a locator that matched nothing, missing setup), fix it with write_test.\n\n${buggy.output}`;
      model.addResults([{ use, output: feedback, isError: buggy.passed }, ...others(use)], []);
    }

    // The judge: the clean site, run once, with nothing sent back to the model. Any test whose
    // last version failed on the buggy build gets judged, confirmed or out of attempts.
    if (result.file && result.status !== "passes-on-buggy") {
      result.status = runTest(file, CLEAN_URL).passed ? "valid" : "fails-on-clean";
    }

    results.push(result);
    console.log(`bug ${n}: ${result.status.padEnd(15)} (${result.attempts} attempt${result.attempts > 1 ? "s" : ""})  ${bug.title}`);
  }

  const costUsd =
    (usage.input * price.input + usage.output * price.output + usage.cacheWrite * price.cacheWrite + usage.cacheRead * price.cacheRead) / 1e6;
  writeFileSync(
    path.join(testsDir, "tests.json"),
    JSON.stringify({ model: modelName, buggyUrl: BUGGY_URL, cleanUrl: CLEAN_URL, costUsd, usage, results }, null, 2),
  );
  const valid = results.filter((r) => r.status === "valid").length;
  console.log(`\n${valid}/${results.length} valid regression tests, $${costUsd.toFixed(3)}. Saved to ${testsDir}/`);
}

await main();
