import { ScorelineChips } from "@/components/ScorelineChips";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { number, pct } from "@/lib/format";
import { groupName, teamName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { buildModelIterationState } from "@/lib/model-iteration";
import { bestThirds, groupStandings, oddsQuotesByMatchMap } from "@/lib/standings";
import { topScorelines } from "@/lib/trade-plans";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const modelIteration = buildModelIterationState(overrides, odds, teamInputs);
  const standings = groupStandings(overrides, odds, teamInputs, modelIteration);
  const thirds = bestThirds(standings);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const groupMatches = data.fixtures
    .filter((match) => match.stage === "group")
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .map((match) => ({
      match,
      result: overrideMap.get(match.id),
      prediction: predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides })
    }));
  const groupStats = hitStats(groupMatches);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>小组赛回顾</h1>
          <p>保留小组赛最终积分、逐场实际比分、赛前预测方向和前三比分，用来继续校准淘汰赛模型。</p>
        </div>
        <span className="pill">{groupMatches.filter((row) => row.result).length} 场已结束</span>
      </section>

      <section className="grid-3">
        {data.groups.map((group) => (
          <div key={group.id} className="panel">
            <h2>{groupName(group.id)}</h2>
            <div className="table-wrap">
              <table suppressHydrationWarning>
                <thead>
                  <tr>
                    <th>球队</th>
                    <th>分</th>
                    <th>净胜</th>
                    <th>进球</th>
                  </tr>
                </thead>
                <tbody>
                  {standings[group.id].map((row, index) => (
                    <tr key={row.team}>
                      <td className="team">
                        {index + 1}. {teamName(row.team)}
                      </td>
                      <td>{number(row.points, 1)}</td>
                      <td>{number(row.goalDifference, 1)}</td>
                      <td>{number(row.goalsFor, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>最佳第三名最终排序</h2>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>排名</th>
                <th>球队</th>
                <th>组</th>
                <th>积分</th>
                <th>净胜球</th>
                <th>进球</th>
              </tr>
            </thead>
            <tbody>
              {thirds.map((row, index) => (
                <tr key={row.team}>
                  <td>{index + 1}</td>
                  <td className="team">{teamName(row.team)}</td>
                  <td>{groupName(row.group)}</td>
                  <td>{number(row.points, 1)}</td>
                  <td>{number(row.goalDifference, 1)}</td>
                  <td>{number(row.goalsFor, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="section-title-row">
          <h2>小组赛逐场预测与结果</h2>
          <div className="pill-row">
            <span className="pill ok">胜平负 {formatHitStat(groupStats.sideHits, groupStats.total)}</span>
            <span className="pill ok">比分 {formatHitStat(groupStats.scoreHits, groupStats.total)}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>比赛</th>
                <th>实际</th>
                <th>赛前方向</th>
                <th>方向概率</th>
                <th>前三比分</th>
              </tr>
            </thead>
            <tbody>
              {groupMatches.map(({ match, result, prediction }) => {
                const side = favoriteSide(prediction.blended);
                const actualScore = result ? `${result.homeScore}-${result.awayScore}` : null;
                const scoreHit = actualScore ? scorelineHit(prediction.xgHome, prediction.xgAway, side, actualScore) : false;
                return (
                  <tr key={match.id} className={result && !scoreHit ? "scoreline-miss-row" : undefined}>
                    <td className="team">{teamName(match.home)} vs {teamName(match.away)}</td>
                    <td>{result ? `${result.homeScore}-${result.awayScore}` : "未结束"}</td>
                    <td>{favoriteLabel(match.home, match.away, side)}</td>
                    <td>{pct(prediction.blended[side])}</td>
                    <td>
                      <ScorelineChips homeXg={prediction.xgHome} awayXg={prediction.xgAway} preferred={side} hitScore={actualScore ?? undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function favoriteSide(probs: { home: number; draw: number; away: number }): "home" | "draw" | "away" {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function favoriteLabel(home: string, away: string, side: "home" | "draw" | "away"): string {
  if (side === "home") return `${teamName(home)}胜`;
  if (side === "away") return `${teamName(away)}胜`;
  return "平局";
}

function scorelineHit(xgHome: number, xgAway: number, side: "home" | "draw" | "away", actualScore: string): boolean {
  return topScorelines(xgHome, xgAway, 3, side).some((score) => score.score === actualScore);
}

function hitStats(rows: Array<{ result?: { homeScore: number; awayScore: number }; prediction: { blended: { home: number; draw: number; away: number }; xgHome: number; xgAway: number } }>): { total: number; sideHits: number; scoreHits: number } {
  let total = 0;
  let sideHits = 0;
  let scoreHits = 0;
  for (const row of rows) {
    if (!row.result) continue;
    total += 1;
    const side = favoriteSide(row.prediction.blended);
    const actual = row.result.homeScore > row.result.awayScore ? "home" : row.result.homeScore < row.result.awayScore ? "away" : "draw";
    if (side === actual) sideHits += 1;
    const actualScore = `${row.result.homeScore}-${row.result.awayScore}`;
    if (topScorelines(row.prediction.xgHome, row.prediction.xgAway, 3, side).some((score) => score.score === actualScore)) scoreHits += 1;
  }
  return { total, sideHits, scoreHits };
}

function formatHitStat(hits: number, total: number): string {
  return total ? `${hits}/${total}=${pct(hits / total)}` : "暂无";
}
