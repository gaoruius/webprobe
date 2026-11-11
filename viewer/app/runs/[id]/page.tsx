import Link from "next/link";
import { notFound } from "next/navigation";
import { Stat, StopBadge, RecallBar } from "@/components/ui";
import { brief, duration, pageOf, tokens, usd, when } from "@/lib/format";
import { getRun, truth, type FiledBug, type RegressionTest, type ToolCall } from "@/lib/runs";

export const dynamic = "force-dynamic";

// Long snapshots would make the page unusable; the full text is in report.json.
const MAX_OUTPUT = 6000;

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();

  const bugs = truth();
  const verdict = new Map<number, Verdict>();
  for (const f of run.score.found) verdict.set(f.report, { kind: "found", id: f.id });
  for (const d of run.score.duplicates) verdict.set(d.report, { kind: "duplicate", id: d.id });
  for (const e of run.score.extras) verdict.set(e.report, { kind: "extra", id: e.id });

  const steps = new Map<number, ToolCall[]>();
  for (const c of run.toolCalls) steps.set(c.step, [...(steps.get(c.step) ?? []), c]);

  return (
    <>
      <p className="crumbs">
        <Link href="/">All runs</Link> / {run.id}
      </p>
      <h1 className="run-title">
        {run.model} <span className="muted">· {when(run.startedAt)}</span>
      </h1>

      <div className="stats">
        <Stat label="Stopped" value={<StopBadge reason={run.stoppedBecause} />} />
        <Stat
          label="Recall"
          value={<RecallBar recall={run.score.recall} found={run.score.found.length} live={run.score.live.length} />}
        />
        <Stat label="Reports" value={run.bugs.length} />
        <Stat label="Steps" value={run.steps} />
        <Stat label="Time" value={duration(run.seconds)} />
        <Stat label="Cost" value={usd(run.costUsd)} />
        <Stat label="Tokens in / out" value={`${tokens(run.usage.input + run.usage.cacheRead)} / ${tokens(run.usage.output)}`} />
        {run.tests && (
          <Stat
            label="Regression tests"
            value={`${[...run.tests.byBug.values()].filter((t) => t.status === "valid").length} / ${run.tests.byBug.size} valid`}
          />
        )}
      </div>

      {run.error && (
        <p className="callout callout-bad">
          <strong>Run failed:</strong> {run.error}
        </p>
      )}
      {run.summary && (
        <p className="callout">
          <strong>Agent's summary:</strong> {run.summary}
        </p>
      )}

      <section>
        <h2>Scorecard</h2>
        {run.score.live.length === 0 ? (
          <p className="muted">Clean site: no bugs were live, so every report is a false positive.</p>
        ) : (
          <ul className="scorecard">
            {bugs
              .filter((b) => run.score.live.includes(b.id))
              .map((b) => {
                const hit = run.score.found.find((f) => f.id === b.id);
                return (
                  <li key={b.id} className={hit ? "hit" : "miss"}>
                    <span className="mark" aria-label={hit ? "found" : "missed"}>
                      {hit ? "✓" : "✗"}
                    </span>
                    <div>
                      <div className="score-id">
                        {b.id} <span className="muted small">{b.category} · {[b.page].flat().join(", ")}</span>
                      </div>
                      <div className="small">{b.summary}</div>
                      {hit && (
                        <a className="small" href={`#bug-${hit.report}`}>
                          Found by report #{hit.report + 1}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <section>
        <h2>Reports ({run.bugs.length})</h2>
        {run.bugs.length === 0 && <p className="muted">The agent filed no bugs.</p>}
        <div className="cards">
          {run.bugs.map((bug, i) => (
            <BugCard key={i} runId={run.id} index={i} bug={bug} verdict={verdict.get(i)} test={run.tests?.byBug.get(i + 1)} />
          ))}
        </div>
      </section>

      <section>
        <h2>Timeline</h2>
        <ol className="timeline">
          {[...steps.entries()].map(([step, calls]) => (
            <li key={step}>
              <span className="step-num">{step}</span>
              <div className="step-calls">
                {calls.map((c, j) => (
                  <details key={j} className={c.isError ? "call call-error" : "call"}>
                    <summary>
                      <code className="tool">{c.name}</code> <span className="muted small">{brief(c.input)}</span>
                      {pageOf(c.output) && <span className="at small">{pageOf(c.output)}</span>}
                    </summary>
                    <pre>
                      {c.output.length > MAX_OUTPUT
                        ? `${c.output.slice(0, MAX_OUTPUT)}\n… ${c.output.length - MAX_OUTPUT} more characters in report.json`
                        : c.output}
                    </pre>
                  </details>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

type Verdict = { kind: "found" | "duplicate" | "extra"; id: string };

const VERDICT_LABEL: Record<Verdict["kind"], string> = {
  found: "matches",
  duplicate: "duplicate of",
  extra: "real, not seeded:",
};

function BugCard({
  runId,
  index,
  bug,
  verdict,
  test,
}: {
  runId: string;
  index: number;
  bug: FiledBug;
  verdict?: Verdict;
  test?: RegressionTest;
}) {
  return (
    <article className="card" id={`bug-${index}`}>
      <header className="card-head">
        <span className="muted small">#{index + 1}</span>
        <span className={`badge sev-${bug.severity}`}>{bug.severity}</span>
        <span className="badge badge-neutral">{bug.category}</span>
        <code className="small">{bug.page}</code>
        <span className="spacer" />
        {verdict ? (
          <span className={`badge ${verdict.kind === "duplicate" ? "badge-neutral" : "badge-good"}`}>
            {VERDICT_LABEL[verdict.kind]} {verdict.id}
          </span>
        ) : (
          <span className="badge badge-bad">no match: check by hand</span>
        )}
      </header>
      <h3>{bug.title}</h3>
      {bug.screenshot && (
        // Served from the run folder by app/runs/[id]/files/[name]/route.ts.
        <a href={`/runs/${runId}/files/${bug.screenshot}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="shot" src={`/runs/${runId}/files/${bug.screenshot}`} alt={`Page when bug #${index + 1} was filed`} />
        </a>
      )}
      <div className="card-grid">
        <div>
          <h4>Steps</h4>
          <ol className="small">
            {bug.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>Expected</h4>
          <p className="small">{bug.expected}</p>
          <h4>Actual</h4>
          <p className="small">{bug.actual}</p>
        </div>
      </div>
      <h4>Evidence</h4>
      <pre>{bug.evidence}</pre>
      {test && <TestPanel test={test} />}
    </article>
  );
}

const TEST_STATUS: Record<RegressionTest["status"], { label: string; tone: string; note: string }> = {
  valid: { label: "valid", tone: "badge-good", note: "Fails with the bug, passes on the clean site." },
  "fails-on-clean": {
    label: "fails on clean site",
    tone: "badge-bad",
    note: "Also fails on the clean site: it asserts something else, or the bug is real and not seeded.",
  },
  "passes-on-buggy": { label: "misses the bug", tone: "badge-bad", note: "Passes on the buggy site, so it would not catch the bug." },
  "no-test": { label: "no test", tone: "badge-neutral", note: "The model did not return a test." },
};

function TestPanel({ test }: { test: RegressionTest }) {
  const s = TEST_STATUS[test.status];
  return (
    <details className="test">
      <summary>
        <span className="small">Regression test</span> <span className={`badge ${s.tone}`}>{s.label}</span>{" "}
        <span className="muted small">
          {s.note} {test.attempts > 1 ? `${test.attempts} attempts.` : ""}
        </span>
      </summary>
      {test.code && <pre>{test.code}</pre>}
    </details>
  );
}
