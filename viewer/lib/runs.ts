// Reads agent runs from disk and scores them. Server-only: it uses node:fs.
//
// Scoring reuses the agent's eval code, so the numbers here are the numbers
// `npm run eval` prints.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { liveBugs, score, type ExtraBug, type Score, type TruthBug } from "../../agent/src/eval";
import type { BugReport } from "../../agent/src/tools";

export const RUNS_DIR = process.env.WEBPROBE_RUNS ?? path.resolve(process.cwd(), "../agent/runs");
const MANIFEST = path.resolve(process.cwd(), "../buggyshop/bugs.manifest.json");

export type ToolCall = { step: number; name: string; input: unknown; isError: boolean; output: string };

export type FiledBug = BugReport & { screenshot?: string };

// A spec rule as the agent accounted for it at finish; pageOpened is checked against its trace.
export type SpecCheckResult = { page: string; rule: string; result: "pass" | "fail" | "not tested"; pageOpened: boolean };

// The agent is told when 3 steps are left, so a run that got that far used its whole budget.
export const hitBudget = (r: Run) =>
  r.stoppedBecause === "max_steps" || (r.maxSteps !== undefined && r.steps >= r.maxSteps - 3);

// Above this share of runs hitting the budget, the budget is too small for the job.
export const HIT_BUDGET_WARN = 0.2;

// Regression tests written by `npm run gen-tests` (agent/src/gen-tests.ts), one per bug.
export type RegressionTest = {
  bug: number;
  status: "valid" | "passes-on-buggy" | "fails-on-clean" | "no-test";
  attempts: number;
  code?: string;
};

export type RunTests = { model: string; costUsd: number; byBug: Map<number, RegressionTest> };

export type Run = {
  id: string;
  startedAt: Date;
  provider: string;
  model: string;
  effort?: string;
  prompt?: string;
  coverageGate?: boolean;
  spec?: string;
  device?: string;
  maxSteps?: number;
  specChecks?: SpecCheckResult[];
  target?: string;
  liveBugs: string;
  seconds?: number;
  steps: number;
  stoppedBecause: string;
  error?: string;
  summary: string;
  costUsd: number;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  bugs: FiledBug[];
  toolCalls: ToolCall[];
  score: Score;
  tests?: RunTests;
};

type Manifest = { bugs: TruthBug[]; extras?: ExtraBug[] };

const manifest = (): Manifest => JSON.parse(readFileSync(MANIFEST, "utf8"));

export function truth(): TruthBug[] {
  return manifest().bugs;
}

// Real defects that were not seeded, confirmed by a person (see bugs.manifest.json).
export function extras(): ExtraBug[] {
  return manifest().extras ?? [];
}

// Run folders are named by start time with ':' and '.' replaced: 2026-11-08T06-16-38-934Z.
function startedAt(id: string): Date {
  return new Date(id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "T$1:$2:$3.$4Z"));
}

const ID = /^[\w-]+$/;

export function getRun(id: string, bugs = truth(), extraBugs = extras()): Run | null {
  if (!ID.test(id)) return null;
  const file = path.join(RUNS_DIR, id, "report.json");
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const live = raw.liveBugs ?? "all";
  return {
    ...raw,
    id,
    startedAt: startedAt(id),
    provider: raw.provider ?? "claude",
    model: raw.model ?? "claude-opus-5-5",
    liveBugs: live,
    summary: raw.summary ?? "",
    toolCalls: raw.toolCalls ?? [],
    score: score(raw.bugs ?? [], liveBugs(bugs, live), extraBugs),
    tests: readTests(path.join(RUNS_DIR, id, "tests")),
  };
}

function readTests(dir: string): RunTests | undefined {
  const file = path.join(dir, "tests.json");
  if (!existsSync(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const byBug = new Map<number, RegressionTest>();
  for (const r of raw.results as (RegressionTest & { file?: string })[]) {
    const code = r.file && existsSync(path.join(dir, r.file)) ? readFileSync(path.join(dir, r.file), "utf8") : undefined;
    byBug.set(r.bug, { bug: r.bug, status: r.status, attempts: r.attempts, code });
  }
  return { model: raw.model, costUsd: raw.costUsd, byBug };
}

export function listRuns(): Run[] {
  if (!existsSync(RUNS_DIR)) return [];
  const bugs = truth();
  const extraBugs = extras();
  return readdirSync(RUNS_DIR)
    .filter((id) => ID.test(id))
    .map((id) => getRun(id, bugs, extraBugs))
    .filter((r): r is Run => r !== null)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export type ModelSummary = {
  key: string;
  provider: string;
  model: string;
  // What the runs were scored against: "5 bugs", "10 bugs", "clean site".
  site: string;
  runs: number;
  recall: number | null;
  precision: number | null;
  falsePositivesPerRun: number;
  avgSteps: number;
  // Runs that used their whole step budget, out of `runs`.
  hitBudget: number;
  costUsd: number;
};

const mean = (xs: (number | null)[]) => {
  const ys = xs.filter((x): x is number => x !== null);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};

const siteOf = (r: Run) =>
  (r.score.live.length ? `${r.score.live.length} bugs` : "clean site") +
  (r.prompt && r.prompt !== "default" ? `, ${r.prompt} prompt` : "") +
  (r.coverageGate ? ", coverage gate" : "") +
  (r.device ? `, ${r.device}` : "") +
  (r.spec ? ", with spec" : "") +
  (r.maxSteps !== undefined ? `, ${r.maxSteps} steps` : "");

// One row per provider/model and set of live bugs, since recall on 5 bugs and on 10 don't average. Runs that crashed before doing anything are left out:
// they say nothing about the model.
export function summarizeByModel(runs: Run[]): ModelSummary[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.stoppedBecause === "error" && r.steps <= 1) continue;
    const key = `${r.provider}/${r.model}/${siteOf(r)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => ({
    key,
    provider: rs[0].provider,
    model: rs[0].model,
    site: siteOf(rs[0]),
    runs: rs.length,
    recall: mean(rs.map((r) => r.score.recall)),
    precision: mean(rs.map((r) => r.score.precision)),
    falsePositivesPerRun: rs.reduce((a, r) => a + r.score.falsePositives.length, 0) / rs.length,
    avgSteps: rs.reduce((a, r) => a + r.steps, 0) / rs.length,
    hitBudget: rs.filter(hitBudget).length,
    costUsd: rs.reduce((a, r) => a + r.costUsd, 0),
  }))
    .sort((a, b) => (parseInt(b.site) || 0) - (parseInt(a.site) || 0));
}
