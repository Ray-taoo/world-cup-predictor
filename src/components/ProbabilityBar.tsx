import { pct } from "@/lib/format";

export function ProbabilityBar({
  label,
  value,
  tone = "blue"
}: {
  label: string;
  value: number;
  tone?: "blue" | "green" | "red" | "amber";
}) {
  return (
    <div className="prob-row">
      <div className="prob-label">
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div className="prob-track" aria-hidden="true">
        <div className={`prob-fill ${tone}`} style={{ width: `${Math.max(1, Math.min(100, value * 100))}%` }} />
      </div>
    </div>
  );
}
