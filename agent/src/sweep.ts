// Recall and cost against the step budget, for runs that differ only in their budget.
//
//   npm run sweep -- --model claude-haiku-5-5 --spec        (runs given SPEC.md)
//   npm run sweep -- --model claude-haiku-5-5 --out ../docs/step-sweep.svg
//
// Groups runs in runs/ by maxSteps (recorded in report.json) and prints mean recall, steps used
// and cost per budget. With --out, also writes the curve as an SVG.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveBugs, score, type ExtraBug, type TruthBug } from "./eval.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(here, "../runs");
const manifest = JSON.parse(readFileSync(path.join(here, "../../buggyshop/bugs.manifest.json"), "utf8")) as {
  bugs: TruthBug[];
  extras?: ExtraBug[];
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag("--model") ?? "claude-haiku-5-5";
const withSpec = args.includes("--spec");
const out = flag("--out");

type Point = { budget: number; runs: number; recall: number; stepsMin: number; stepsMax: number; cost: number };

const groups = new Map<number, { recall: number; steps: number; cost: number }[]>();
for (const id of readdirSync(RUNS)) {
  const file = path.join(RUNS, id, "report.json");
  if (!existsSync(file)) continue;
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (r.model !== model || Boolean(r.spec) !== withSpec || r.maxSteps === undefined || r.stoppedBecause === "error") continue;
  if (r.prompt && r.prompt !== "default") continue;
  if (r.coverageGate) continue;
  const s = score(r.bugs ?? [], liveBugs(manifest.bugs, r.liveBugs ?? "all"), manifest.extras ?? []);
  if (s.recall === null || s.live.length !== manifest.bugs.length) continue; // only the current bug set
  groups.set(r.maxSteps, [...(groups.get(r.maxSteps) ?? []), { recall: s.recall, steps: r.steps, cost: r.costUsd }]);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const points: Point[] = [...groups.entries()]
  .sort(([a], [b]) => a - b)
  .map(([budget, rs]) => ({
    budget,
    runs: rs.length,
    recall: mean(rs.map((r) => r.recall)),
    stepsMin: Math.min(...rs.map((r) => r.steps)),
    stepsMax: Math.max(...rs.map((r) => r.steps)),
    cost: mean(rs.map((r) => r.cost)),
  }));

if (points.length === 0) {
  console.error(`No runs for ${model}${withSpec ? " with a spec" : ""} with a recorded budget.`);
  process.exit(1);
}

console.log(`${model}${withSpec ? ", with spec" : ""}, ${manifest.bugs.length} bugs\n`);
console.log("budget  runs  recall  steps used  cost/run");
for (const p of points) {
  console.log(
    `${String(p.budget).padStart(6)}  ${String(p.runs).padStart(4)}  ${`${Math.round(p.recall * 100)}%`.padStart(6)}  ${`${p.stepsMin}–${p.stepsMax}`.padStart(10)}  $${p.cost.toFixed(3)}`,
  );
}

if (out) {
  writeFileSync(out, chart(points, `${model}${withSpec ? " + spec" : ""}: recall vs. step budget (3 runs each)`));
  console.log(`\nWrote ${out}`);
}

// A small line chart: recall against budget, with the steps actually used as a note per point.
function chart(ps: Point[], title: string): string {
  const W = 560, H = 300, L = 56, R = 40, T = 64, B = 52;
  const lo = Math.min(...ps.map((p) => p.budget)) - 8;
  const hi = Math.max(...ps.map((p) => p.budget)) + 8;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const used = (p: Point) => (p.stepsMin === p.stepsMax ? `used ${p.stepsMin}` : `used ${p.stepsMin}–${p.stepsMax}`);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const line = ps.map((p, i) => `${i ? "L" : "M"}${x(p.budget).toFixed(1)},${y(p.recall).toFixed(1)}`).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">
  <style>
    .bg { fill: #ffffff } .ink { fill: #1f2328 } .muted { fill: #656d76 } .grid { stroke: #e1e4e8 }
    .line { stroke: #3b5bdb; fill: none; stroke-width: 2.5 } .dot { fill: #3b5bdb }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0d1117 } .ink { fill: #e6edf3 } .muted { fill: #8d96a0 } .grid { stroke: #30363d }
      .line { stroke: #7c95f5 } .dot { fill: #7c95f5 }
    }
  </style>
  <rect class="bg" width="${W}" height="${H}" rx="8"/>
  <text class="ink" x="${L}" y="24" font-weight="600" font-size="13">${title}</text>
${yTicks
  .map(
    (t) =>
      `  <line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>\n  <text class="muted" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`,
  )
  .join("\n")}
  <path class="line" d="${line}"/>
${ps
  .map(
    (p) =>
      `  <circle class="dot" cx="${x(p.budget)}" cy="${y(p.recall)}" r="4.5"/>\n  <text class="ink" x="${x(p.budget)}" y="${y(p.recall) - 10}" text-anchor="middle" font-weight="600">${Math.round(p.recall * 100)}%</text>\n  <text class="muted" x="${x(p.budget)}" y="${H - B + 18}" text-anchor="middle">${p.budget}</text>\n  <text class="muted" x="${x(p.budget)}" y="${H - B + 32}" text-anchor="middle" font-size="10">${used(p)}</text>`,
  )
  .join("\n")}
  <text class="muted" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">step budget (steps actually used below)</text>
</svg>
`;
}
