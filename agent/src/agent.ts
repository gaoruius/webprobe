// The agent loop, written by hand: ask the model, run the tools it asks for, append the
// results, repeat. Three things stop it: the model calls `finish`, it runs out of steps,
// or it runs out of money.
//
// The loop knows nothing about any one model API. Providers (providers/claude.ts,
// gemini.ts, groq.ts) turn our tool definitions and results into their own format.

import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { claude } from "./providers/claude.js";
import { gemini } from "./providers/gemini.js";
import { groq } from "./providers/groq.js";
import type { Effort, Provider, ProviderOptions, ToolDef, ToolResult, ToolUse, Usage } from "./providers/types.js";
import { BugReport, Finish, localTools } from "./tools.js";

export const PROVIDERS = { claude, gemini, groq } as const;
export type ProviderName = keyof typeof PROVIDERS;

export type AgentOptions = {
  mcp: Client;
  target: string;
  provider: ProviderName;
  model?: string;
  maxSteps: number;
  maxCostUsd: number;
  effort: Effort;
  // "budget" tells the model its step budget and asks it to keep testing until it is used.
  prompt?: PromptVariant;
  // Refuse `finish` while pages linked from visited pages are still unopened and steps remain.
  coverageGate?: boolean;
  // Where to save a screenshot for each filed bug. Leave out to skip screenshots.
  screenshotDir?: string;
  log?: (line: string) => void;
};

// Browser tools the harness uses but the model never sees. A screenshot would cost the
// model far more context than a snapshot, so only we take them, as evidence for reports.
const HARNESS_ONLY_TOOLS = new Set(["screenshot"]);

export type FiledBug = BugReport & { screenshot?: string };

// After the step budget runs out, the model gets this many extra turns in which only
// report_bug and finish work. Without it, a model that explores until the last step
// ends the run having filed nothing it saw.
const WRAP_UP_TURNS = 5;

// The coverage gate stops refusing after this many refusals, or when this few steps are left.
const MAX_GATE_REFUSALS = 3;
const GATE_RESERVE_STEPS = 3;

// Same-site pages, as paths, that the browser was on ("URL: …", "Opened …", "Now at …") and that
// snapshots linked to ("/url: …"). Generic: it reads the browser tools' output, not the site.
export function pagesIn(output: string, origin: string): { visited: string[]; linked: string[] } {
  const path = (url: string) => {
    try {
      const u = new URL(url.replace(/^['"]|['".,]+$/g, ""), origin);
      return u.origin === origin ? u.pathname.replace(/(.)\/+$/, "$1") : null;
    } catch {
      return null;
    }
  };
  const all = (re: RegExp) => [...output.matchAll(re)].map((m) => path(m[1])).filter((p): p is string => p !== null);
  return {
    visited: all(/(?:^URL: |Opened |Now at )(\S+)/gm),
    linked: all(/^\s*- \/url: (\S+)/gm),
  };
}

export type ToolCall = { step: number; name: string; input: unknown; isError: boolean; output: string };

export type AgentResult = {
  provider: ProviderName;
  model: string;
  bugs: FiledBug[];
  summary: string;
  stoppedBecause: "finished" | "ended_turn" | "max_steps" | "max_cost" | "refusal" | "max_tokens" | "error";
  error?: string;
  steps: number;
  usage: Usage;
  costUsd: number;
  toolCalls: ToolCall[];
  // Same-site pages the agent opened, and ones it saw linked but never opened.
  pages: { visited: string[]; unvisited: string[] };
  messages: unknown;
};

export type PromptVariant = "default" | "budget";

const systemPrompt = (target: string, variant: PromptVariant, maxSteps: number) => `You are a QA engineer testing the web app at ${target}.

Explore it the way a careful tester would: visit every page you can reach, use the main flows end to end, and try edge cases (empty, zero, negative and malformed input). After each action, check what the page shows, and check console_errors and network_errors: some bugs are only visible there.

When you confirm a bug, file it right away with report_bug. Report only what you observed through the tools, one report per distinct bug. When you have covered the site, call finish.

You can only reach ${target}. Element refs change whenever the page updates, so take a new snapshot before clicking or typing on a changed page.${variant === "budget" ? budgetNote(maxSteps) : ""}`;

const budgetNote = (maxSteps: number) => `

You have ${maxSteps} steps. Use them: stopping early with parts of the site untested is worse than running out of steps. Before you call finish, list the pages, flows and controls you have not tried yet. If anything is on that list and you have steps left, test it instead of finishing.`;

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const log = opts.log ?? (() => {});

  // MCP tool definitions map almost 1:1 onto model tool definitions.
  const { tools: mcpTools } = await opts.mcp.listTools();
  const browserTools: ToolDef[] = mcpTools.filter((t) => !HARNESS_ONLY_TOOLS.has(t.name)).map((t) => {
    const { $schema, ...schema } = t.inputSchema as Record<string, unknown>;
    return { name: t.name, description: t.description ?? "", schema };
  });

  const providerOptions: ProviderOptions = {
    model: opts.model,
    system: systemPrompt(opts.target, opts.prompt ?? "default", opts.maxSteps),
    firstMessage: `Test ${opts.target} and report every bug you find.`,
    tools: [...browserTools, ...localTools],
    effort: opts.effort,
  };
  const model: Provider = PROVIDERS[opts.provider](providerOptions);

  const bugs: FiledBug[] = [];
  const toolCalls: ToolCall[] = [];
  const usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const cost = () =>
    (usage.input * model.price.input +
      usage.output * model.price.output +
      usage.cacheWrite * model.price.cacheWrite +
      usage.cacheRead * model.price.cacheRead) /
    1e6;

  let summary = "";
  let stoppedBecause: AgentResult["stoppedBecause"] = "max_steps";
  let lastCall = "";
  let repeats = 0;
  let step = 0;
  let finished = false;
  let error: string | undefined;
  const origin = new URL(opts.target).origin;
  const visited = new Set<string>();
  const linked = new Set<string>();
  const unvisited = () => [...linked].filter((p) => !visited.has(p));
  let gateRefusals = 0;

  // A screenshot of the page as it is when the bug is filed. Best effort: a report without
  // one is still a report.
  async function saveScreenshot(n: number): Promise<string | undefined> {
    if (!opts.screenshotDir) return undefined;
    try {
      const res = await opts.mcp.callTool({ name: "screenshot", arguments: {} });
      const image = (res.content as { type: string; data?: string }[]).find((c) => c.type === "image");
      if (res.isError || !image?.data) return undefined;
      const name = `bug-${n}.png`;
      writeFileSync(path.join(opts.screenshotDir, name), Buffer.from(image.data, "base64"));
      return name;
    } catch {
      return undefined;
    }
  }

  async function runTool(use: ToolUse): Promise<ToolResult> {
    if (use.name === "report_bug") {
      const parsed = BugReport.safeParse(use.input);
      if (!parsed.success) return { use, output: `Invalid report: ${parsed.error.message}`, isError: true };
      const bug: FiledBug = parsed.data;
      bugs.push(bug);
      bug.screenshot = await saveScreenshot(bugs.length);
      return { use, output: `Filed bug #${bugs.length}.`, isError: false };
    }
    if (step > opts.maxSteps && use.name !== "finish") {
      return { use, output: "Out of steps: only report_bug and finish work now.", isError: true };
    }
    if (use.name === "finish") {
      const left = opts.maxSteps - step;
      const missing = unvisited();
      if (opts.coverageGate && missing.length && left > GATE_RESERVE_STEPS && gateRefusals < MAX_GATE_REFUSALS) {
        gateRefusals++;
        return {
          use,
          output:
            `Not finished: pages you saw linked but never opened: ${missing.join(", ")}. ` +
            `You have ${left} steps left. Test those pages, then call finish.`,
          isError: true,
        };
      }
      const parsed = Finish.safeParse(use.input);
      summary = parsed.success ? parsed.data.summary : "";
      finished = true;
      return { use, output: "Done.", isError: false };
    }
    // Browser tool: forward to the MCP server. It validates the input itself and
    // returns errors as isError results, which we pass straight back to the model.
    const res = await opts.mcp.callTool({ name: use.name, arguments: use.input });
    const output = (res.content as { type: string; text?: string }[])
      .map((c) => c.text ?? `[${c.type}]`)
      .join("\n");
    const pages = pagesIn(output, origin);
    pages.visited.forEach((p) => visited.add(p));
    pages.linked.forEach((p) => linked.add(p));
    return { use, output, isError: Boolean(res.isError) };
  }

  while (step < opts.maxSteps + WRAP_UP_TURNS) {
    if (cost() >= opts.maxCostUsd) {
      stoppedBecause = "max_cost";
      break;
    }
    step++;

    // A failed model call ends the run but keeps what it found so far.
    let turn;
    try {
      turn = await model.next();
    } catch (err) {
      stoppedBecause = "error";
      error = err instanceof Error ? err.message : String(err);
      break;
    }
    for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += turn.usage[k];
    for (const text of turn.text) log(`  ${text}`);

    if (turn.stop !== "tool_use") {
      stoppedBecause = turn.stop === "end_turn" ? "ended_turn" : turn.stop;
      break;
    }

    const results: ToolResult[] = [];
    for (const use of turn.toolUses) {
      const result = await runTool(use);
      results.push(result);
      toolCalls.push({ step, name: use.name, input: use.input, isError: result.isError, output: result.output });
      log(`${String(step).padStart(3)} ${result.isError ? "✗" : "→"} ${use.name} ${brief(use.input)}`);
    }

    const notes: string[] = [];
    const signature = turn.toolUses.map((u) => u.name + JSON.stringify(u.input)).join("|");
    repeats = signature === lastCall ? repeats + 1 : 0;
    lastCall = signature;
    if (repeats >= 2) {
      notes.push("You have made the same call three times in a row. Try something different.");
    }
    const left = opts.maxSteps - step;
    if (left === 3) {
      notes.push(`Only ${left} steps left. File any bugs you have confirmed, then call finish.`);
    }
    if (left === 0) {
      notes.push(
        "You are out of steps and the browser tools are now disabled. File every bug you " +
          "observed with report_bug, then call finish.",
      );
    }

    model.addResults(results, notes);
    if (finished) {
      stoppedBecause = "finished";
      break;
    }
  }

  return {
    provider: opts.provider,
    model: model.model,
    bugs,
    summary,
    stoppedBecause,
    error,
    steps: step,
    usage,
    costUsd: cost(),
    toolCalls,
    pages: { visited: [...visited].sort(), unvisited: unvisited().sort() },
    messages: model.history(),
  };
}

function brief(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}
