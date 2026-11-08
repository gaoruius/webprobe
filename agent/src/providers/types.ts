// What the agent loop needs from a model provider. Each provider keeps its own message
// history in its native format, so nothing provider-specific (Claude thinking blocks,
// Gemini thought signatures) is lost when we send the history back.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ToolDef = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  // Ask the provider to guarantee inputs match the schema, where it supports that.
  strict?: boolean;
};

export type ToolUse = { id: string; name: string; input: Record<string, unknown> };

export type ToolResult = { use: ToolUse; output: string; isError: boolean };

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };

export type Turn = {
  text: string[];
  toolUses: ToolUse[];
  stop: "tool_use" | "end_turn" | "refusal" | "max_tokens";
  usage: Usage;
};

export interface Provider {
  readonly name: string;
  readonly model: string;
  // USD per million tokens.
  readonly price: Usage;
  next(): Promise<Turn>;
  // Tool results for the last turn, plus notes from the harness that go in the same message.
  addResults(results: ToolResult[], notes: string[]): void;
  history(): unknown;
}

export type ProviderOptions = {
  model?: string;
  system: string;
  firstMessage: string;
  tools: ToolDef[];
  effort: Effort;
};
