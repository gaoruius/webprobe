// The agent's own tools. The browser tools come from browser-mcp; these two are how the
// agent hands results back to us, so they run in this process, not in the MCP server.

import { z } from "zod";
import type { ToolDef } from "./providers/types.js";

export const CATEGORIES = ["functional", "validation", "a11y", "network", "console", "visual", "other"] as const;

export const BugReport = z.object({
  title: z.string().min(1),
  page: z.string().min(1),
  category: z.enum(CATEGORIES),
  severity: z.enum(["critical", "major", "minor"]),
  steps: z.array(z.string()).min(1),
  expected: z.string(),
  actual: z.string(),
  evidence: z.string(),
});
export type BugReport = z.infer<typeof BugReport>;

export const Finish = z.object({ summary: z.string() });

// With a spec, finish also accounts for every rule in it: the coverage report.
export const SPEC_RESULTS = ["pass", "fail", "not tested"] as const;
export const SpecCheck = z.object({
  page: z.string(),
  rule: z.string().min(1),
  result: z.enum(SPEC_RESULTS),
});
export type SpecCheck = z.infer<typeof SpecCheck>;
export const FinishWithChecks = Finish.extend({ checks: z.array(SpecCheck) });

// strict: true makes the API guarantee the input matches the schema (Claude supports this;
// Gemini ignores it). We still parse with zod before using it, because the schema is the
// contract and the check costs nothing.
export const localTools: ToolDef[] = [
  {
    name: "report_bug",
    description:
      "File one bug you have observed yourself in the browser. Call once per distinct bug, " +
      "right after you confirm it. Evidence must be something a tool returned to you " +
      "(a console message, a failed request, a snapshot line), not a guess.",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "page", "category", "severity", "steps", "expected", "actual", "evidence"],
      properties: {
        title: { type: "string", description: "One line, e.g. 'Coupon error is not shown to the user'" },
        page: { type: "string", description: "Path where it happens, e.g. /cart" },
        category: { type: "string", enum: [...CATEGORIES] },
        severity: { type: "string", enum: ["critical", "major", "minor"] },
        steps: { type: "array", items: { type: "string" }, description: "Steps to reproduce" },
        expected: { type: "string" },
        actual: { type: "string" },
        evidence: { type: "string", description: "Tool output that shows the bug" },
      },
    },
  },
  {
    name: "finish",
    description: "Call when you have explored the site and filed every bug you found.",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "What you covered, and anything you could not test" },
      },
    },
  },
];

// The finish tool for runs with a spec: one entry per spec rule, tested or not.
export const specFinishTool: ToolDef = {
  name: "finish",
  description:
    "Call when you have explored the site and filed every bug you found. List every rule in the " +
    "spec with what you found: pass, fail (you filed a bug), or not tested. Say not tested for " +
    "anything you did not actually try in the browser.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "checks"],
    properties: {
      summary: { type: "string", description: "What you covered, and anything you could not test" },
      checks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page", "rule", "result"],
          properties: {
            page: { type: "string", description: "Path the rule is about, e.g. /cart" },
            rule: { type: "string", description: "The rule, briefly, in the spec's words" },
            result: { type: "string", enum: [...SPEC_RESULTS] },
          },
        },
      },
    },
  },
};
