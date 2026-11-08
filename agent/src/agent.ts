// The agent loop, written by hand: ask the model, run the tools it asks for, append the
// results, repeat. Three things stop it: the model calls `finish`, it runs out of steps,
// or it runs out of money.
//
// The loop knows nothing about any one model API. Providers (providers/claude.ts,
// providers/gemini.ts) turn our tool definitions and results into their own format.

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { claude } from "./providers/claude.js";
import { gemini } from "./providers/gemini.js";
import type { Effort, Provider, ProviderOptions, ToolDef, ToolResult, ToolUse, Usage } from "./providers/types.js";
import { BugReport, Finish, localTools } from "./tools.js";

export const PROVIDERS = { claude, gemini } as const;
export type ProviderName = keyof typeof PROVIDERS;

export type AgentOptions = {
  mcp: Client;
  target: string;
  provider: ProviderName;
  model?: string;
  maxSteps: number;
  maxCostUsd: number;
  effort: Effort;
  log?: (line: string) => void;
};

export type ToolCall = { step: number; name: string; input: unknown; isError: boolean; output: string };

export type AgentResult = {
  provider: ProviderName;
  model: string;
  bugs: BugReport[];
  summary: string;
  stoppedBecause: "finished" | "ended_turn" | "max_steps" | "max_cost" | "refusal" | "max_tokens" | "error";
  error?: string;
  steps: number;
  usage: Usage;
  costUsd: number;
  toolCalls: ToolCall[];
  messages: unknown;
};

const systemPrompt = (target: string) => `You are a QA engineer testing the web app at ${target}.

Explore it the way a careful tester would: visit every page you can reach, use the main flows end to end, and try edge cases (empty, zero, negative and malformed input). After each action, check what the page shows, and check console_errors and network_errors: some bugs are only visible there.

When you confirm a bug, file it right away with report_bug. Report only what you observed through the tools, one report per distinct bug. When you have covered the site, call finish.

You can only reach ${target}. Element refs change whenever the page updates, so take a new snapshot before clicking or typing on a changed page.`;

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const log = opts.log ?? (() => {});

  // MCP tool definitions map almost 1:1 onto model tool definitions.
  const { tools: mcpTools } = await opts.mcp.listTools();
  const browserTools: ToolDef[] = mcpTools.map((t) => {
    const { $schema, ...schema } = t.inputSchema as Record<string, unknown>;
    return { name: t.name, description: t.description ?? "", schema };
  });

  const providerOptions: ProviderOptions = {
    model: opts.model,
    system: systemPrompt(opts.target),
    firstMessage: `Test ${opts.target} and report every bug you find.`,
    tools: [...browserTools, ...localTools],
    effort: opts.effort,
  };
  const model: Provider = PROVIDERS[opts.provider](providerOptions);

  const bugs: BugReport[] = [];
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

  async function runTool(use: ToolUse): Promise<ToolResult> {
    if (use.name === "report_bug") {
      const parsed = BugReport.safeParse(use.input);
      if (!parsed.success) return { use, output: `Invalid report: ${parsed.error.message}`, isError: true };
      bugs.push(parsed.data);
      return { use, output: `Filed bug #${bugs.length}.`, isError: false };
    }
    if (use.name === "finish") {
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
    return { use, output, isError: Boolean(res.isError) };
  }

  while (step < opts.maxSteps) {
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
    messages: model.history(),
  };
}

function brief(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}
