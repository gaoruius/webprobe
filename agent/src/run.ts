// Run the agent once against BuggyShop and save what it did.
//
//   npm start                              (BuggyShop must be running on localhost:3000)
//   WEBPROBE_PROVIDER=gemini npm start     (Gemini instead of Claude; also: groq)
//
// Writes runs/<timestamp>/report.json (bugs, cost, stop reason, every tool call),
// transcript.json (the full message history, for debugging the agent) and a bug-<n>.png
// screenshot for each bug filed. View them with the viewer: cd viewer && npm run dev.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PROVIDERS, runAgent, type AgentOptions, type PromptVariant, type ProviderName } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(here, "../../buggyshop/bugs.manifest.json");
const target = process.env.WEBPROBE_TARGET ?? "http://localhost:3000";
// Default to whichever provider we have a key for, in this order.
const KEY_VARS: Record<ProviderName, string> = {
  claude: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
};
const hasKey = (p: ProviderName) =>
  Boolean(process.env[KEY_VARS[p]] || (p === "claude" && process.env.ANTHROPIC_AUTH_TOKEN));
const provider = (process.env.WEBPROBE_PROVIDER ??
  (Object.keys(KEY_VARS) as ProviderName[]).find(hasKey) ??
  "claude") as ProviderName;
const model = process.env.WEBPROBE_MODEL || undefined;
// Which BuggyShop bugs were on for this run, for the eval. Set it to whatever
// NEXT_PUBLIC_BUGS BuggyShop was started with ("none" for `npm run dev:clean`).
// The agent never sees it.
// "all" is recorded as the explicit list, so old runs still score right after bugs are added.
const liveBugsSetting = process.env.WEBPROBE_LIVE_BUGS ?? "all";
const liveBugs =
  liveBugsSetting === "all"
    ? (JSON.parse(readFileSync(MANIFEST, "utf8")).bugs as { id: string }[]).map((b) => b.id).join(",")
    : liveBugsSetting;
const maxSteps = Number(process.env.WEBPROBE_MAX_STEPS ?? 40);
const maxCostUsd = Number(process.env.WEBPROBE_MAX_COST_USD ?? 2);
const effort = (process.env.WEBPROBE_EFFORT ?? "medium") as AgentOptions["effort"];
const prompt = (process.env.WEBPROBE_PROMPT ?? "default") as PromptVariant;
const coverageGate = process.env.WEBPROBE_COVERAGE_GATE === "1";

if (!(provider in PROVIDERS)) {
  console.error(`Unknown WEBPROBE_PROVIDER "${provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
  process.exit(1);
}
if (!hasKey(provider)) {
  console.error(`No API key. Put ${KEY_VARS[provider]}=... in agent/.env (it is gitignored).`);
  process.exit(1);
}

try {
  await fetch(target);
} catch {
  console.error(`Can't reach ${target}. Start BuggyShop first: cd buggyshop && npm run dev`);
  process.exit(1);
}

// The MCP server gets our environment minus the API keys: it drives a browser and never
// needs to call a model.
const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, GEMINI_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, ...env } =
  process.env;
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

console.log(`WebProbe: ${provider}, effort ${effort}, prompt ${prompt}${coverageGate ? ", coverage gate" : ""}, up to ${maxSteps} steps / $${maxCostUsd} on ${target}\n`);
const started = Date.now();
const runDir = path.resolve(here, "../runs", new Date(started).toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });
const result = await runAgent({
  mcp,
  target,
  provider,
  model,
  maxSteps,
  maxCostUsd,
  effort,
  prompt,
  coverageGate,
  screenshotDir: runDir,
  log: console.log,
});
await mcp.close();

const { messages, ...report } = result;
writeFileSync(
  path.join(runDir, "report.json"),
  JSON.stringify({ effort, prompt, coverageGate, target, liveBugs, seconds: (Date.now() - started) / 1000, ...report }, null, 2),
);
writeFileSync(path.join(runDir, "transcript.json"), JSON.stringify(messages, null, 2));

console.log(`\n${result.provider} / ${result.model}`);
console.log(`Stopped: ${result.stoppedBecause} after ${result.steps} steps, $${result.costUsd.toFixed(2)}`);
if (result.error) console.log(`Error: ${result.error}`);
console.log(`Bugs filed: ${result.bugs.length}`);
for (const [i, b] of result.bugs.entries()) {
  console.log(`  ${i + 1}. [${b.category}/${b.severity}] ${b.page}  ${b.title}`);
}
if (result.summary) console.log(`\nSummary: ${result.summary}`);
console.log(`\nSaved to ${path.relative(process.cwd(), runDir)}/`);
