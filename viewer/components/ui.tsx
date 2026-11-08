import { pct, stopLabel, stopTone } from "@/lib/format";

export function StopBadge({ reason }: { reason: string }) {
  return <span className={`badge badge-${stopTone(reason)}`}>{stopLabel(reason)}</span>;
}

// Recall as a bar plus the found/live count. Nothing live (clean site) shows a dash.
export function RecallBar({ recall, found, live }: { recall: number | null; found?: number; live?: number }) {
  return (
    <span className="recall">
      <span className="bar" aria-hidden>
        <span className="bar-fill" style={{ width: `${(recall ?? 0) * 100}%` }} />
      </span>
      <span className="recall-num">
        {pct(recall)}
        {found !== undefined && live ? <span className="muted"> {found}/{live}</span> : null}
      </span>
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
