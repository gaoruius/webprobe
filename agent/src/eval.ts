// Score agent runs against BuggyShop's ground truth.
//
//   npm run eval -- runs/<a> runs/<b> ...
//
// Each run is scored against the bugs that were live for it, recorded in report.json as
// liveBugs (same values as NEXT_PUBLIC_BUGS: "all", "none" or a comma list of ids).
// --live <value> overrides that for every run given.
//
// A report finds a bug when it is on the bug's page (a `*` segment in the manifest, or a
// route parameter like [id] in the report, matches any one segment) and the bug's `match` regex hits its
// title, actual or evidence. Each live bug is found at most once; further reports of it
// are duplicates. A report that matches none of them but matches one of the manifest's
// `extras` (real defects that were not seeded, confirmed by a person) on its page and
// title is an extra find: correct for precision, outside recall. Anything else is a false positive: on the clean
// site, that is every report but extras. Keyword matching is crude, so false positives are
// printed for a human to check; a confirmed one belongs in `extras`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BugReport } from "./tools.js";

export type TruthBug = { id: string; device?: string; page: string | string[]; category: string; summary: string; match: string };

export type Score = {
  live: string[];
  found: { id: string; report: number }[];
  missed: string[];
  duplicates: { id: string; report: number }[];
  extras: { id: string; report: number }[];
  falsePositives: number[];
  recall: number | null; // null when no bug is live
  precision: number | null; // null when nothing was reported
};

export function normalizePage(page: string): string {
  let p = page.trim();
  try {
    // decodeURI undoes the escaping URL adds, so "<id>" stays a wildcard.
    p = decodeURI(new URL(p, "http://x").pathname);
  } catch {
    // Not a URL or a path we can parse; compare it as written.
  }
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

// A path segment that stands for any value: "*" in the manifest, or a route parameter
// such as "[id]", ":id" or "<id>", which is how agents (and SPEC.md) write "every product page".
const WILDCARD = /^(\*|\[[^\]]+\]|:.+|<[^>]+>)$/;

export function pageMatches(reported: string, truth: string): boolean {
  const a = normalizePage(reported).split("/");
  const b = normalizePage(truth).split("/");
  return a.length === b.length && a.every((seg, i) => seg === b[i] || WILDCARD.test(seg) || WILDCARD.test(b[i]));
}

export function liveBugs(truth: TruthBug[], live: string): TruthBug[] {
  if (live === "all") return truth;
  if (live === "none") return [];
  const ids = new Set(live.split(",").map((s) => s.trim()));
  return truth.filter((b) => ids.has(b.id));
}

export type ExtraBug = { id: string; page: string | string[]; match: string; summary: string };

// A bug can list several pages when it can fairly be reported from any of them.
const onPage = (r: BugReport, page: string | string[]) => [page].flat().some((p) => pageMatches(r.page, p));

const hits = (r: BugReport, b: { page: string | string[]; match: string }) =>
  onPage(r, b.page) && new RegExp(b.match, "i").test(`${r.title}\n${r.actual}\n${r.evidence}`);

export function score(reports: BugReport[], live: TruthBug[], extraBugs: ExtraBug[] = []): Score {
  const found: Score["found"] = [];
  const duplicates: Score["duplicates"] = [];
  const extras: Score["extras"] = [];
  const falsePositives: number[] = [];

  reports.forEach((r, i) => {
    const candidates = live.filter((b) => hits(r, b));
    // Two bugs on one page can both match; prefer the one whose category the agent named,
    // then one not found yet.
    candidates.sort(
      (a, b) =>
        Number(b.category === r.category) - Number(a.category === r.category) ||
        Number(found.some((f) => f.id === a.id)) - Number(found.some((f) => f.id === b.id)),
    );
    const bug = candidates[0];
    // Extras match on the title only: evidence often shows other problems on the same page
    // (a discounted price looks like a fractional quantity).
    const extra = bug
      ? undefined
      : extraBugs.find((b) => onPage(r, b.page) && new RegExp(b.match, "i").test(r.title));
    if (extra) extras.push({ id: extra.id, report: i });
    else if (!bug) falsePositives.push(i);
    else if (found.some((f) => f.id === bug.id)) duplicates.push({ id: bug.id, report: i });
    else found.push({ id: bug.id, report: i });
  });

  return {
    live: live.map((b) => b.id),
    found,
    missed: live.filter((b) => !found.some((f) => f.id === b.id)).map((b) => b.id),
    duplicates,
    extras,
    falsePositives,
    recall: live.length ? found.length / live.length : null,
    precision: reports.length ? (found.length + duplicates.length + extras.length) / reports.length : null,
  };
}

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};

// Unbiased estimates from n runs of which c succeeded, over every way to pick k of them.
// pass@k: at least one of k succeeds (HumanEval). Right for finding bugs: runs can be merged.
export function passAtK(n: number, c: number, k: number): number {
  return n - c < k ? 1 : 1 - choose(n - c, k) / choose(n, k);
}

// pass^k: all k succeed (τ-bench). Right for staying quiet on a clean site: one false alarm
// in k runs is enough to lose trust.
export function passHatK(n: number, c: number, k: number): number {
  return choose(c, k) / choose(n, k);
}

type RunReport = {
  platform?: "web" | "ios";
  liveBugs?: string;
  provider?: string;
  model?: string;
  bugs: BugReport[];
  steps: number;
  stoppedBecause: string;
  costUsd: number;
  seconds?: number;
};

const pct = (x: number | null) => (x === null ? "  -" : `${Math.round(x * 100)}%`.padStart(4));
const mean = (xs: (number | null)[]) => {
  const ys = xs.filter((x): x is number => x !== null);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};

function main(argv: string[]) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let override: string | undefined;
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--live") override = argv[++i];
    else dirs.push(argv[i]);
  }
  if (!dirs.length) {
    console.error("Usage: npm run eval -- [--live all|none|id,id] runs/<dir> ...");
    process.exit(1);
  }

  // iOS runs are scored against the iOS app's answer key.
  const manifests = {
    web: path.resolve(here, "../../buggyshop/bugs.manifest.json"),
    ios: path.resolve(here, "../../ios/bugs.manifest.json"),
  };
  const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { bugs: TruthBug[]; extras?: ExtraBug[] };

  const scores: Score[] = [];
  const seen = new Map<string, TruthBug>();
  for (const dir of dirs) {
    const run = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as RunReport;
    const { bugs: truth, extras: extraBugs = [] } = load(manifests[run.platform === "ios" ? "ios" : "web"]);
    for (const b of truth) seen.set(b.id, b);
    const live = override ?? run.liveBugs ?? "all";
    const bugs = liveBugs(truth, live);
    const s = score(run.bugs, bugs, extraBugs);
    scores.push(s);
    console.log(
      `${path.basename(path.resolve(dir))}  ${run.provider ?? "?"} / ${run.model ?? "?"}  ` +
        `${run.steps} steps, ${run.stoppedBecause}, $${run.costUsd.toFixed(2)}` +
        (run.seconds ? `, ${Math.round(run.seconds)}s` : "") +
        `, live bugs: ${live}`,
    );
    console.log(
      `  recall ${pct(s.recall)} (${s.found.length}/${s.live.length})   precision ${pct(s.precision)}   ` +
        `reports ${run.bugs.length}, duplicates ${s.duplicates.length}, extra finds ${s.extras.length}, ` +
        `false positives ${s.falsePositives.length}`,
    );
    for (const f of s.found) console.log(`    ✓ ${f.id}  ← "${run.bugs[f.report].title}"`);
    for (const id of s.missed) console.log(`    ✗ missed ${id}`);
    for (const e of s.extras) console.log(`    + extra ${e.id}  ← "${run.bugs[e.report].title}"`);
    for (const i of s.falsePositives) {
      const r = run.bugs[i];
      console.log(`    ? false positive [${r.category}] ${r.page}  "${r.title}"`);
    }
    console.log();
  }

  if (scores.length > 1) {
    console.log(
      `Mean over ${scores.length} runs: recall ${pct(mean(scores.map((s) => s.recall)))}, ` +
        `precision ${pct(mean(scores.map((s) => s.precision)))}, ` +
        `false positives ${(scores.reduce((a, s) => a + s.falsePositives.length, 0) / scores.length).toFixed(1)}/run`,
    );
    const perBug: { n: number; c: number }[] = [];
    for (const b of seen.values()) {
      const live = scores.filter((s) => s.live.includes(b.id));
      if (!live.length) continue;
      const c = live.filter((s) => s.found.some((f) => f.id === b.id)).length;
      perBug.push({ n: live.length, c });
      console.log(`  ${b.id.padEnd(24)} found in ${c}/${live.length} runs`);
    }

    // Each bug is a task and each run a trial; k can't exceed the fewest runs any bug was live in.
    const ks = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    if (perBug.length) {
      const kMax = Math.min(...perBug.map((b) => b.n));
      const avg = (f: (b: { n: number; c: number }, k: number) => number, k: number) =>
        perBug.reduce((a, b) => a + f(b, k), 0) / perBug.length;
      console.log(
        `  Per bug over runs: ` +
          ks(kMax).map((k) => `pass@${k} ${pct(avg((b, k) => passAtK(b.n, b.c, k), k))}`).join("  ") +
          `   ` +
          ks(kMax).map((k) => `pass^${k} ${pct(avg((b, k) => passHatK(b.n, b.c, k), k))}`).join("  "),
      );
    }
    const quiet = scores.filter((s) => s.falsePositives.length === 0).length;
    console.log(
      `  No false positive: ${quiet}/${scores.length} runs   ` +
        ks(scores.length).map((k) => `pass^${k} ${pct(passHatK(scores.length, quiet, k))}`).join("  "),
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
