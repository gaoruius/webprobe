// Gemini through the Google Gen AI SDK.
//
// Like the Claude provider, the history is append-only: we push each model turn back
// exactly as it arrived, so its thought signatures stay attached to the function calls.

import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import type { Effort, Provider, ProviderOptions, ToolResult, Turn } from "./types.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export function gemini(opts: ProviderOptions): Provider {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    // The free tier has tight per-minute limits; back off and retry on 429 instead of failing.
    httpOptions: { retryOptions: { attempts: 8, initialDelay: 5, maxDelay: 60 } },
  });
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const contents: Content[] = [{ role: "user", parts: [{ text: opts.firstMessage }] }];
  const madeUpIds = new Set<string>();
  const config = {
    systemInstruction: opts.system,
    tools: [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.schema,
        })),
      },
    ],
    thinkingConfig: { thinkingLevel: THINKING[opts.effort] },
    maxOutputTokens: 16000,
  };

  return {
    name: "gemini",
    model,
    // Free tier. Fill in the paid-tier prices for the model here if you move off it,
    // otherwise the cost budget never triggers.
    price: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },

    async next(): Promise<Turn> {
      const response = await ai.models.generateContent({ model, contents, config });

      // promptTokenCount includes the cached part; thinking tokens are billed as output.
      const meta = response.usageMetadata;
      const cached = meta?.cachedContentTokenCount ?? 0;
      const usage = {
        input: (meta?.promptTokenCount ?? 0) - cached,
        output: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
        cacheWrite: 0,
        cacheRead: cached,
      };

      const candidate = response.candidates?.[0];
      const content = candidate?.content;
      const reason = candidate?.finishReason ?? "";
      if (response.promptFeedback?.blockReason || BLOCKED.has(reason) || !content?.parts) {
        return { text: [], toolUses: [], stop: reason === "MAX_TOKENS" ? "max_tokens" : "refusal", usage };
      }

      const parts: Part[] = content.parts;
      const text = parts.flatMap((p) => (p.text && !p.thought && p.text.trim() ? [p.text.trim()] : []));
      if (reason === "MAX_TOKENS") return { text, toolUses: [], stop: "max_tokens", usage };
      contents.push(content);

      // Gemini may leave out call ids; make one up so the loop can pair calls with results,
      // and leave it out again when sending the result back.
      const toolUses = parts.flatMap((p, i) => {
        if (!p.functionCall?.name) return [];
        let id = p.functionCall.id;
        if (!id) madeUpIds.add((id = `call_${contents.length}_${i}`));
        return [{ id, name: p.functionCall.name, input: p.functionCall.args ?? {} }];
      });
      return { text, toolUses, stop: toolUses.length ? "tool_use" : "end_turn", usage };
    },

    addResults(results: ToolResult[], notes: string[]) {
      const parts: Part[] = results.map((r) => ({
        functionResponse: {
          ...(madeUpIds.has(r.use.id) ? {} : { id: r.use.id }),
          name: r.use.name,
          response: r.isError ? { error: r.output } : { output: r.output },
        },
      }));
      for (const note of notes) parts.push({ text: note });
      contents.push({ role: "user", parts });
    },

    history: () => contents,
  };
}
