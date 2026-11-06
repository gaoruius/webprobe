// Run the agent once against BuggyShop and save what it did.
//
//   npm start                      (BuggyShop must be running on localhost:3000)
//
// Writes runs/<timestamp>/report.json (bugs, cost, stop reason, every tool call) and
// transcript.json (the full message history, for debugging the agent).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MODEL, runAgent, type AgentOptions } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.WEBPROBE_TARGET ?? "http://localhost:3000";
const maxSteps = Number(process.env.WEBPROBE_MAX_STEPS ?? 40);
const maxCostUsd = Number(process.env.WEBPROBE_MAX_COST_USD ?? 2);
const effort = (process.env.WEBPROBE_EFFORT ?? "medium") as AgentOptions["effort"];

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("No API key. Put ANTHROPIC_API_KEY=... in agent/.env (it is gitignored).");
  process.exit(1);
}

try {
  await fetch(target);
} catch {
  console.error(`Can't reach ${target}. Start BuggyShop first: cd buggyshop && npm run dev`);
  process.exit(1);
}

// The MCP server gets our environment minus the API key: it drives a browser and never
// needs to call the model.
const { ANTHROPIC_API_KEY, ...env } = process.env;
const mcp = new Client({ name: "webprobe-agent", version: "0.1.0" });
await mcp.connect(
  new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/server.ts"],
    cwd: path.resolve(here, "../../browser-mcp"),
    env: env as Record<string, string>,
    stderr: "ignore",
  }),
);

console.log(`WebProbe: ${MODEL}, effort ${effort}, up to ${maxSteps} steps / $${maxCostUsd} on ${target}\n`);
const started = Date.now();
const result = await runAgent({ mcp, target, maxSteps, maxCostUsd, effort, log: console.log });
await mcp.close();

const runDir = path.resolve(here, "../runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
const { messages, ...report } = result;
writeFileSync(
  path.join(runDir, "report.json"),
  JSON.stringify({ model: MODEL, effort, target, seconds: (Date.now() - started) / 1000, ...report }, null, 2),
);
writeFileSync(path.join(runDir, "transcript.json"), JSON.stringify(messages, null, 2));

console.log(`\nStopped: ${result.stoppedBecause} after ${result.steps} steps, $${result.costUsd.toFixed(2)}`);
console.log(`Bugs filed: ${result.bugs.length}`);
for (const [i, b] of result.bugs.entries()) {
  console.log(`  ${i + 1}. [${b.category}/${b.severity}] ${b.page}  ${b.title}`);
}
if (result.summary) console.log(`\nSummary: ${result.summary}`);
console.log(`\nSaved to ${path.relative(process.cwd(), runDir)}/`);
