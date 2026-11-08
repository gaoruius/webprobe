// Score agent runs against BuggyShop's ground truth.
//
//   npm run eval -- runs/<a> runs/<b> ...
//
// Each run is scored against the bugs that were live for it, recorded in report.json as
// liveBugs (same values as NEXT_PUBLIC_BUGS: "all", "none" or a comma list of ids).
// --live <value> overrides that for every run given.
//
// A report finds a bug when it is on the bug's page and the bug's `match` regex hits its
// title, actual or evidence. Each live bug is found at most once; further reports of it
// are duplicates. Any other report is a false positive: on the clean site, that is every
// report. Keyword matching is crude, so false positives are printed for a human to check.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BugReport } from "./tools.js";

export type TruthBug = { id: string; page: string; category: string; summary: string; match: string };

export type Score = {
  live: string[];
  found: { id: string; report: number }[];
  missed: string[];
  duplicates: { id: string; report: number }[];
  falsePositives: number[];
  recall: number | null; // null when no bug is live
  precision: number | null; // null when nothing was reported
};

export function normalizePage(page: string): string {
  let p = page.trim();
  try {
    p = new URL(p, "http://x").pathname;
  } catch {
    // Not a URL or a path we can parse; compare it as written.
  }
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function liveBugs(truth: TruthBug[], live: string): TruthBug[] {
  if (live === "all") return truth;
  if (live === "none") return [];
  const ids = new Set(live.split(",").map((s) => s.trim()));
  return truth.filter((b) => ids.has(b.id));
}

export function score(reports: BugReport[], live: TruthBug[]): Score {
  const found: Score["found"] = [];
  const duplicates: Score["duplicates"] = [];
  const falsePositives: number[] = [];

  reports.forEach((r, i) => {
    const text = `${r.title}\n${r.actual}\n${r.evidence}`;
    const candidates = live.filter(
      (b) => normalizePage(r.page) === normalizePage(b.page) && new RegExp(b.match, "i").test(text),
    );
    // Two bugs on one page can both match; prefer the one whose category the agent named,
    // then one not found yet.
    candidates.sort(
      (a, b) =>
        Number(b.category === r.category) - Number(a.category === r.category) ||
        Number(found.some((f) => f.id === a.id)) - Number(found.some((f) => f.id === b.id)),
    );
    const bug = candidates[0];
    if (!bug) falsePositives.push(i);
    else if (found.some((f) => f.id === bug.id)) duplicates.push({ id: bug.id, report: i });
    else found.push({ id: bug.id, report: i });
  });

  return {
    live: live.map((b) => b.id),
    found,
    missed: live.filter((b) => !found.some((f) => f.id === b.id)).map((b) => b.id),
    duplicates,
    falsePositives,
    recall: live.length ? found.length / live.length : null,
    precision: reports.length ? (found.length + duplicates.length) / reports.length : null,
  };
}

type RunReport = {
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

  const manifest = path.resolve(here, "../../buggyshop/bugs.manifest.json");
  const truth = (JSON.parse(readFileSync(manifest, "utf8")) as { bugs: TruthBug[] }).bugs;

  const scores: Score[] = [];
  for (const dir of dirs) {
    const run = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as RunReport;
    const live = override ?? run.liveBugs ?? "all";
    const bugs = liveBugs(truth, live);
    const s = score(run.bugs, bugs);
    scores.push(s);
    console.log(
      `${path.basename(path.resolve(dir))}  ${run.provider ?? "?"} / ${run.model ?? "?"}  ` +
        `${run.steps} steps, ${run.stoppedBecause}, $${run.costUsd.toFixed(2)}` +
        (run.seconds ? `, ${Math.round(run.seconds)}s` : "") +
        `, live bugs: ${live}`,
    );
    console.log(
      `  recall ${pct(s.recall)} (${s.found.length}/${s.live.length})   precision ${pct(s.precision)}   ` +
        `reports ${run.bugs.length}, duplicates ${s.duplicates.length}, false positives ${s.falsePositives.length}`,
    );
    for (const f of s.found) console.log(`    ✓ ${f.id}  ← "${run.bugs[f.report].title}"`);
    for (const id of s.missed) console.log(`    ✗ missed ${id}`);
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
    for (const b of truth) {
      const live = scores.filter((s) => s.live.includes(b.id));
      if (!live.length) continue;
      const n = live.filter((s) => s.found.some((f) => f.id === b.id)).length;
      console.log(`  ${b.id.padEnd(24)} found in ${n}/${live.length} runs`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
