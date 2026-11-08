// Reads agent runs from disk and scores them. Server-only: it uses node:fs.
//
// Scoring reuses the agent's eval code, so the numbers here are the numbers
// `npm run eval` prints.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { liveBugs, score, type Score, type TruthBug } from "../../agent/src/eval";
import type { BugReport } from "../../agent/src/tools";

export const RUNS_DIR = process.env.WEBPROBE_RUNS ?? path.resolve(process.cwd(), "../agent/runs");
const MANIFEST = path.resolve(process.cwd(), "../buggyshop/bugs.manifest.json");

export type ToolCall = { step: number; name: string; input: unknown; isError: boolean; output: string };

export type FiledBug = BugReport & { screenshot?: string };

export type Run = {
  id: string;
  startedAt: Date;
  provider: string;
  model: string;
  effort?: string;
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
};

export function truth(): TruthBug[] {
  return (JSON.parse(readFileSync(MANIFEST, "utf8")) as { bugs: TruthBug[] }).bugs;
}

// Run folders are named by start time with ':' and '.' replaced: 2026-11-08T06-16-38-934Z.
function startedAt(id: string): Date {
  return new Date(id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, "T$1:$2:$3.$4Z"));
}

const ID = /^[\w-]+$/;

export function getRun(id: string, bugs = truth()): Run | null {
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
    score: score(raw.bugs ?? [], liveBugs(bugs, live)),
  };
}

export function listRuns(): Run[] {
  if (!existsSync(RUNS_DIR)) return [];
  const bugs = truth();
  return readdirSync(RUNS_DIR)
    .filter((id) => ID.test(id))
    .map((id) => getRun(id, bugs))
    .filter((r): r is Run => r !== null)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export type ModelSummary = {
  key: string;
  provider: string;
  model: string;
  runs: number;
  recall: number | null;
  precision: number | null;
  falsePositivesPerRun: number;
  avgSteps: number;
  costUsd: number;
};

const mean = (xs: (number | null)[]) => {
  const ys = xs.filter((x): x is number => x !== null);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};

// One row per provider/model. Runs that crashed before doing anything are left out:
// they say nothing about the model.
export function summarizeByModel(runs: Run[]): ModelSummary[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.stoppedBecause === "error" && r.steps <= 1) continue;
    const key = `${r.provider}/${r.model}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => ({
    key,
    provider: rs[0].provider,
    model: rs[0].model,
    runs: rs.length,
    recall: mean(rs.map((r) => r.score.recall)),
    precision: mean(rs.map((r) => r.score.precision)),
    falsePositivesPerRun: rs.reduce((a, r) => a + r.score.falsePositives.length, 0) / rs.length,
    avgSteps: rs.reduce((a, r) => a + r.steps, 0) / rs.length,
    costUsd: rs.reduce((a, r) => a + r.costUsd, 0),
  }));
}
