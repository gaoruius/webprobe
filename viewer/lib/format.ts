export const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export const usd = (x: number) => (x === 0 ? "$0" : x < 0.01 ? "<$0.01" : `$${x.toFixed(2)}`);

export function duration(seconds?: number): string {
  if (seconds === undefined) return "–";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function brief(input: unknown, max = 80): string {
  const s = JSON.stringify(input);
  if (!s || s === "{}") return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const STOP_LABELS: Record<string, string> = {
  finished: "Finished",
  ended_turn: "Ended without finish",
  max_steps: "Step limit",
  max_cost: "Cost limit",
  refusal: "Refused",
  max_tokens: "Output limit",
  error: "Error",
};

export const stopLabel = (s: string) => STOP_LABELS[s] ?? s;

// Good, neutral or bad, for colouring the stop-reason badge.
export const stopTone = (s: string) => (s === "finished" ? "good" : s === "error" || s === "refusal" ? "bad" : "neutral");

// The page a tool call ended on, from the browser tools' own output ("URL: …" in
// snapshots, "Now at …" after clicks), as a path.
export function pageOf(output: string): string | null {
  const m = output.match(/^URL: (\S+)/m) ?? output.match(/Now at (\S+?)\.?(\s|$)/);
  if (!m) return null;
  try {
    return new URL(m[1]).pathname;
  } catch {
    return null;
  }
}
