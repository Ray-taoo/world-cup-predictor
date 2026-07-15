import { pct } from "@/lib/format";
import { topScorelines, type ScoreLine } from "@/lib/trade-plans";
import type { OutcomeKey } from "@/lib/types";

export function ScorelineChips({
  homeXg,
  awayXg,
  scores,
  preferred,
  hitScore,
  label = "前三比分"
}: {
  homeXg?: number;
  awayXg?: number;
  scores?: ScoreLine[];
  preferred?: OutcomeKey;
  hitScore?: string;
  label?: string;
}) {
  const rows = (scores ?? (homeXg != null && awayXg != null ? topScorelines(homeXg, awayXg, 3, preferred) : [])).slice(0, 3);
  if (!rows.length) return null;
  return (
    <span className="scoreline-chips">
      {label ? <span>{label}</span> : null}
      {rows.map((row) => (
        <strong key={row.score} className={hitScore === row.score ? "scoreline-hit" : undefined}>
          {row.score} · {pct(row.probability)}
        </strong>
      ))}
    </span>
  );
}
