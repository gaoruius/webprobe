// The agent loop, written by hand: ask the model, run the tools it asks for, append the
// results, repeat. Three things stop it: the model calls `finish`, it runs out of steps,
// or it runs out of money.
//
// The message history is append-only. We never edit or drop earlier turns: that keeps the
// prompt cache valid (each request re-reads the whole history at ~5% of the input price),
// and Claude Opus 5.5 rejects edited history that carries its thinking blocks.

import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { BugReport, Finish, localTools } from "./tools.js";

export const MODEL = "claude-opus-5-5";

// USD per million tokens for MODEL. Cache writes (5-minute TTL) cost 1.25x input.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export type AgentOptions = {
  mcp: Client;
  target: string;
  maxSteps: number;
  maxCostUsd: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  log?: (line: string) => void;
};

export type ToolCall = { step: number; name: string; input: unknown; isError: boolean; output: string };

export type AgentResult = {
  bugs: BugReport[];
  summary: string;
  stoppedBecause: "finished" | "ended_turn" | "max_steps" | "max_cost" | "refusal" | "max_tokens";
  steps: number;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  costUsd: number;
  toolCalls: ToolCall[];
  messages: Anthropic.Beta.BetaMessageParam[];
};

const systemPrompt = (target: string) => `You are a QA engineer testing the web app at ${target}.

Explore it the way a careful tester would: visit every page you can reach, use the main flows end to end, and try edge cases (empty, zero, negative and malformed input). After each action, check what the page shows, and check console_errors and network_errors: some bugs are only visible there.

When you confirm a bug, file it right away with report_bug. Report only what you observed through the tools, one report per distinct bug. When you have covered the site, call finish.

You can only reach ${target}. Element refs change whenever the page updates, so take a new snapshot before clicking or typing on a changed page.`;

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const log = opts.log ?? (() => {});
  const client = new Anthropic();

  // MCP tool definitions map almost 1:1 onto Anthropic tool definitions.
  const { tools: mcpTools } = await opts.mcp.listTools();
  const browserTools: Anthropic.Beta.BetaTool[] = mcpTools.map((t) => {
    const { $schema, ...schema } = t.inputSchema as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description ?? "",
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    };
  });
  const tools = [...browserTools, ...localTools];

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Test ${opts.target} and report every bug you find.` },
  ];
  const bugs: BugReport[] = [];
  const toolCalls: ToolCall[] = [];
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const cost = () =>
    (usage.input * PRICE.input +
      usage.output * PRICE.output +
      usage.cacheWrite * PRICE.cacheWrite +
      usage.cacheRead * PRICE.cacheRead) /
    1e6;

  let summary = "";
  let stoppedBecause: AgentResult["stoppedBecause"] = "max_steps";
  let lastCall = "";
  let repeats = 0;
  let step = 0;
  let finished = false;

  async function runTool(use: Anthropic.Beta.BetaToolUseBlock) {
    if (use.name === "report_bug") {
      const parsed = BugReport.safeParse(use.input);
      if (!parsed.success) return { output: `Invalid report: ${parsed.error.message}`, isError: true };
      bugs.push(parsed.data);
      return { output: `Filed bug #${bugs.length}.`, isError: false };
    }
    if (use.name === "finish") {
      const parsed = Finish.safeParse(use.input);
      summary = parsed.success ? parsed.data.summary : "";
      finished = true;
      return { output: "Done.", isError: false };
    }
    // Browser tool: forward to the MCP server. It validates the input itself and
    // returns errors as isError results, which we pass straight back to the model.
    const res = await opts.mcp.callTool({ name: use.name, arguments: use.input as Record<string, unknown> });
    const output = (res.content as { type: string; text?: string }[])
      .map((c) => c.text ?? `[${c.type}]`)
      .join("\n");
    return { output, isError: Boolean(res.isError) };
  }

  while (step < opts.maxSteps) {
    if (cost() >= opts.maxCostUsd) {
      stoppedBecause = "max_cost";
      break;
    }
    step++;

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(opts.target),
      tools,
      messages,
      output_config: { effort: opts.effort },
      // Cache everything up to the newest message, so the next request pays the cache-read
      // price for the whole history instead of the full input price.
      cache_control: { type: "ephemeral" },
      // If a safety classifier declines the request, retry it on a fallback model inside
      // the same call instead of ending the run.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) log(`  ${block.text.trim()}`);
    }

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      stoppedBecause = response.stop_reason;
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) {
      stoppedBecause = "ended_turn";
      break;
    }

    // Every tool_use needs a tool_result, all in one user message, errors included.
    const results: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const use of toolUses) {
      const { output, isError } = await runTool(use);
      toolCalls.push({ step, name: use.name, input: use.input, isError, output });
      log(`${String(step).padStart(3)} ${isError ? "✗" : "→"} ${use.name} ${brief(use.input)}`);
      results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: isError });
    }

    // Notes for the model go after the tool results, in the same message.
    const notes: string[] = [];
    const signature = toolUses.map((u) => u.name + JSON.stringify(u.input)).join("|");
    repeats = signature === lastCall ? repeats + 1 : 0;
    lastCall = signature;
    if (repeats >= 2) {
      notes.push("You have made the same call three times in a row. Try something different.");
    }
    const left = opts.maxSteps - step;
    if (left === 3) {
      notes.push(`Only ${left} steps left. File any bugs you have confirmed, then call finish.`);
    }
    for (const note of notes) results.push({ type: "text", text: note });

    messages.push({ role: "user", content: results });
    if (finished) {
      stoppedBecause = "finished";
      break;
    }
  }

  return { bugs, summary, stoppedBecause, steps: step, usage, costUsd: cost(), toolCalls, messages };
}

function brief(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}
