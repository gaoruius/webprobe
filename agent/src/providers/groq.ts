// Open models on Groq through its OpenAI-style chat completions API.
//
// Groq's free tier allows only ~8K tokens per minute, and every request resends the whole
// history, so a long run soon sends more than that in one request. Unlike Claude and
// Gemini, these models carry no signed reasoning in the history, so we can do what the
// other two providers must not: mask old tool results. We keep the full history for the
// transcript, and send only the last KEEP_RESULTS results in full.

import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import type { Effort, Provider, ProviderOptions, ToolResult, Turn } from "./types.js";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const KEEP_RESULTS = 2;
const MASKED = "[Older tool result omitted to save context. Take a new snapshot if you need it.]";

const REASONING: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

export function groq(opts: ProviderOptions): Provider {
  // The SDK honours retry-after on 429, which is how we wait out the per-minute limit.
  const client = new Groq({ maxRetries: 10 });
  const model = opts.model ?? DEFAULT_GROQ_MODEL;
  const tools: ChatCompletionTool[] = opts.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.firstMessage },
  ];

  // The history as sent: every tool result but the last KEEP_RESULTS replaced by a stub.
  function masked(): ChatCompletionMessageParam[] {
    let kept = 0;
    return messages
      .slice()
      .reverse()
      .map((m) => (m.role === "tool" && kept++ >= KEEP_RESULTS ? { ...m, content: MASKED } : m))
      .reverse();
  }

  return {
    name: "groq",
    model,
    // Free tier. Fill in the paid prices for the model here if you upgrade.
    price: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },

    async next(): Promise<Turn> {
      const request = {
        model,
        messages: masked(),
        tools,
        reasoning_effort: REASONING[opts.effort],
        include_reasoning: false,
        max_completion_tokens: 8000,
      };
      // Now and then the model writes its reasoning where the tool call should be and Groq
      // rejects the output (400 output_parse_failed). It is random, so just ask again.
      let response;
      for (let attempt = 1; ; attempt++) {
        try {
          response = await client.chat.completions.create(request);
          break;
        } catch (err) {
          const parseFailed = err instanceof Groq.BadRequestError && /output_parse_failed/.test(err.message);
          if (!parseFailed || attempt >= 3) throw err;
        }
      }

      const usage = {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
        cacheWrite: 0,
        cacheRead: 0,
      };
      const choice = response.choices[0];
      const message = choice?.message;
      const text = message?.content?.trim() ? [message.content.trim()] : [];
      if (!message || choice.finish_reason === "length") return { text, toolUses: [], stop: "max_tokens", usage };

      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls });

      const toolUses = (message.tool_calls ?? []).map((c) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {
          // Leave input empty; the tool will reject it and the model sees the error.
        }
        return { id: c.id, name: c.function.name, input };
      });
      return { text, toolUses, stop: toolUses.length ? "tool_use" : "end_turn", usage };
    },

    addResults(results: ToolResult[], notes: string[]) {
      for (const r of results) {
        messages.push({ role: "tool", tool_call_id: r.use.id, content: r.isError ? `Error: ${r.output}` : r.output });
      }
      if (notes.length) messages.push({ role: "user", content: notes.join("\n") });
    },

    history: () => messages,
  };
}
