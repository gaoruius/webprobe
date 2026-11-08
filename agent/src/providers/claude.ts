// Claude through the Anthropic Messages API.
//
// The message history is append-only. We never edit or drop earlier turns: that keeps the
// prompt cache valid (each request re-reads the whole history at ~5% of the input price),
// and Claude Opus 5.5 rejects edited history that carries its thinking blocks.

import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderOptions, ToolResult, Turn } from "./types.js";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

// USD per million tokens for claude-opus-5-5. Cache writes (5-minute TTL) cost 1.25x input.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export function claude(opts: ProviderOptions): Provider {
  const client = new Anthropic();
  const model = opts.model ?? DEFAULT_CLAUDE_MODEL;
  const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
    ...(t.strict ? { strict: true } : {}),
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.firstMessage }];

  return {
    name: "claude",
    model,
    // Only claude-opus-5-5 prices are known here; other models report 0 cost.
    price: model === DEFAULT_CLAUDE_MODEL ? PRICE : { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },

    async next(): Promise<Turn> {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: opts.system,
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

      const usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      };
      const text = response.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));

      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        return { text, toolUses: [], stop: response.stop_reason, usage };
      }
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
      );
      return { text, toolUses, stop: toolUses.length ? "tool_use" : "end_turn", usage };
    },

    addResults(results: ToolResult[], notes: string[]) {
      // Every tool_use needs a tool_result, all in one user message, errors included.
      // Notes go after the tool results, in the same message.
      const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.use.id,
        content: r.output,
        is_error: r.isError,
      }));
      for (const note of notes) content.push({ type: "text", text: note });
      messages.push({ role: "user", content });
    },

    history: () => messages,
  };
}
