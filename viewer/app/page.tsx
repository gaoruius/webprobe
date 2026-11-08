import Link from "next/link";
import { RecallBar, StopBadge } from "@/components/ui";
import { duration, pct, usd, when } from "@/lib/format";
import { listRuns, RUNS_DIR, summarizeByModel } from "@/lib/runs";

// Runs land on disk while the viewer is open; read them on every request.
export const dynamic = "force-dynamic";

export default function Home() {
  const runs = listRuns();
  const models = summarizeByModel(runs);

  if (!runs.length) {
    return (
      <div className="empty">
        <h1>No runs yet</h1>
        <p>
          Start BuggyShop, then run the agent: <code>cd agent &amp;&amp; npm start</code>. Runs are read from{" "}
          <code>{RUNS_DIR}</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <section>
        <h1>Models</h1>
        <p className="lede">
          Recall is the share of live seeded bugs a run found; precision is the share of its reports that match a
          seeded bug. Runs that crashed on their first step are left out.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Runs</th>
                <th>Mean recall</th>
                <th className="num">Precision</th>
                <th className="num">False pos. / run</th>
                <th className="num">Avg steps</th>
                <th className="num">Total cost</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.key}>
                  <td>
                    <div className="model">{m.model}</div>
                    <div className="muted small">{m.provider}</div>
                  </td>
                  <td className="num">{m.runs}</td>
                  <td>
                    <RecallBar recall={m.recall} />
                  </td>
                  <td className="num">{pct(m.precision)}</td>
                  <td className="num">{m.falsePositivesPerRun.toFixed(1)}</td>
                  <td className="num">{Math.round(m.avgSteps)}</td>
                  <td className="num">{usd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h1>Runs</h1>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Model</th>
                <th>Stopped</th>
                <th className="num">Steps</th>
                <th className="num">Reports</th>
                <th>Recall</th>
                <th className="num">Time</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="row-link">
                  <td>
                    <Link href={`/runs/${r.id}`} className="cover-link">
                      {when(r.startedAt)}
                    </Link>
                    {r.liveBugs === "none" && <span className="badge badge-neutral tag">clean site</span>}
                  </td>
                  <td>
                    <div className="model">{r.model}</div>
                    <div className="muted small">{r.provider}</div>
                  </td>
                  <td>
                    <StopBadge reason={r.stoppedBecause} />
                  </td>
                  <td className="num">{r.steps}</td>
                  <td className="num">{r.bugs.length}</td>
                  <td>
                    <RecallBar recall={r.score.recall} found={r.score.found.length} live={r.score.live.length} />
                  </td>
                  <td className="num">{duration(r.seconds)}</td>
                  <td className="num">{usd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
