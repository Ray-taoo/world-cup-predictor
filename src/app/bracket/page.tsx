import { Trophy } from "lucide-react";

import { KnockoutTree } from "@/components/KnockoutTree";
import { ScorelineChips } from "@/components/ScorelineChips";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { readMatchContexts } from "@/lib/match-context";
import { isCloudflareProduction } from "@/lib/cloudflare";
import { pct } from "@/lib/format";
import { bracketLabel, roundName, teamCode, teamName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { compareModelVersions } from "@/lib/model-variants";
import { buildModelIterationState } from "@/lib/model-iteration";
import { runSimulation } from "@/lib/simulation";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import { topScorelines, type ScoreLine } from "@/lib/trade-plans";
import type { Fixture, MatchContextInput, OverrideResult } from "@/lib/types";

export const dynamic = "force-dynamic";

type RoundKey = "R32" | "R16" | "QF" | "SF" | "Final";
type MatchNode = {
  match: Fixture;
  round: RoundKey;
  result?: OverrideResult;
  prediction: ReturnType<typeof predictionForMatch> | null;
  scoreTopScores: ScoreLine[];
};

const roundOrder: RoundKey[] = ["R32", "R16", "QF", "SF"];
const HYBRID_SCORE_START_MATCH = 85;

export default async function BracketPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const modelIteration = buildModelIterationState(overrides, odds, teamInputs);
  // ponytail: Workers Free allows 10ms CPU; use a persisted simulation snapshot when richer production odds are needed.
  const simulation = isCloudflareProduction() ? null : runSimulation(overrides, odds, teamInputs, 10000, modelIteration);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const contextMap = await readMatchContexts();
  const nodes = data.fixtures
    .filter((match) => match.stage !== "group" && match.stage !== "third_place")
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((match) => buildNode(match, overrideMap, oddsMap, teamInputs, overrides, contextMap));
  const byRound = groupRounds(nodes);
  const leftRounds = Object.fromEntries(roundOrder.map((round) => [round, splitRound(byRound[round]).left])) as Record<RoundKey, MatchNode[]>;
  const rightRounds = Object.fromEntries(roundOrder.map((round) => [round, splitRound(byRound[round]).right])) as Record<RoundKey, MatchNode[]>;
  const finalNode = byRound.Final.find((node) => node.match.matchNumber === 104) ?? byRound.Final[0] ?? null;
  const topChampion = simulation ? Object.entries(simulation.teams).sort((a, b) => b[1].champion - a[1].champion)[0] ?? null : null;
  const topFour = simulation ? Object.entries(simulation.teams)
    .sort((a, b) => b[1].semiFinal - a[1].semiFinal)
    .slice(0, 4) : [];
  const finalPair = simulation ? Object.entries(simulation.teams)
    .sort((a, b) => b[1].final - a[1].final)
    .slice(0, 2) : [];
  const knockoutStats = hitStats(nodes);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>淘汰赛路径</h1>
          <p>按现有赛程、赛果和 10,000 次模拟生成左右半区路径；已结束场次显示实际比分，未来场次显示赛前概率。</p>
        </div>
        <div className="pill-row">
          {simulation ? <span className="pill">{simulation.simulations.toLocaleString("en-US")} 次模拟</span> : null}
          <span className="pill ok">胜平负 {formatHitStat(knockoutStats.sideHits, knockoutStats.total)}</span>
          <span className="pill ok">比分 {formatHitStat(knockoutStats.scoreHits, knockoutStats.scoreTotal)}</span>
        </div>
      </section>

      <KnockoutTree fixtures={data.fixtures} overrides={overrides} odds={odds} teamInputs={teamInputs} iteration={modelIteration} />

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="section-title-row">
          <h2>淘汰赛逐场预测与结果</h2>
          <div className="pill-row">
            <span className="pill ok">胜平负 {formatHitStat(knockoutStats.sideHits, knockoutStats.total)}</span>
            <span className="pill ok">比分 {formatHitStat(knockoutStats.scoreHits, knockoutStats.scoreTotal)}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>比赛</th>
                <th>90分钟实际</th>
                <th>赛前方向</th>
                <th>方向概率</th>
                <th>前三比分</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const prediction = node.prediction;
                const side = favoriteSide(prediction?.blended ?? null) ?? "home";
                const actualScore = normalTimeScore(node.result);
                const scoreHit = actualScore ? node.scoreTopScores.some((score) => score.score === actualScore) : false;
                return (
                  <tr key={node.match.id} className={actualScore && !scoreHit ? "scoreline-miss-row" : undefined}>
                    <td className="team">{teamName(node.match.home)} vs {teamName(node.match.away)}</td>
                    <td>{actualScore ?? (node.result ? "90分钟待同步" : "未结束")}</td>
                    <td>{prediction ? favoriteLabel(node.match.home, node.match.away, side) : "待定"}</td>
                    <td>{prediction ? pct(prediction.blended[side]) : "待定"}</td>
                    <td>{prediction ? <ScorelineChips scores={node.scoreTopScores} hitScore={actualScore ?? undefined} label="" /> : "待定"}</td>
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

function BracketSide({ side, rounds, byRound }: { side: "left" | "right"; rounds: RoundKey[]; byRound: Record<RoundKey, MatchNode[]> }) {
  return (
    <div className={`bracket-side bracket-side-${side}`}>
      {rounds.map((round) => (
        <div key={round} className={`tree-round tree-round-${round.toLowerCase()}`}>
          <h2>{roundName(round)}</h2>
          <div className="tree-match-list">
            {byRound[round].map((node) => (
              <MatchCard key={node.match.id} node={node} side={side} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChampionCenter({
  champion,
  topFour,
  finalPair,
  finalNode
}: {
  champion: [string, { champion: number }] | null;
  topFour: Array<[string, { semiFinal: number }]>;
  finalPair: Array<[string, { final: number }]>;
  finalNode: MatchNode | null;
}) {
  return (
    <aside className="champion-center" aria-label="冠军预测">
      <div className="trophy-mark" aria-hidden="true">
        <Trophy size={42} strokeWidth={1.8} />
      </div>
      <span className="center-kicker">预测冠军</span>
      <strong>{champion ? teamName(champion[0]) : "待定"}</strong>
      <em>{champion ? pct(champion[1].champion) : "暂无"}</em>
      {finalNode ? <MatchCard node={finalNode} side="center" compact /> : null}
      <div className="center-info-grid">
        <div>
          <b>四强预测</b>
          {topFour.map(([team, row]) => (
            <p key={team}>
              <span>{teamCode(team)} {teamName(team)}</span>
              <strong>{pct(row.semiFinal)}</strong>
            </p>
          ))}
        </div>
        <div>
          <b>决赛及冠军</b>
          <p>
            <span>{finalPair.map(([team]) => `${teamCode(team)} ${teamName(team)}`).join(" vs ") || "待定"}</span>
          </p>
          {champion ? (
            <p>
              <span>冠军</span>
              <strong>{teamName(champion[0])} {pct(champion[1].champion)}</strong>
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function MatchCard({ node, side, compact = false }: { node: MatchNode; side: "left" | "right" | "center"; compact?: boolean }) {
  const winner = resultWinner(node.result);
  const favorite = favoriteSide(node.prediction?.blended ?? null);
  const state = node.result ? "complete" : isPlayable(node.match) ? "future" : "pending";

  return (
    <article className={`tree-match tree-match-${side} is-${state}${compact ? " is-compact" : ""}`}>
      <div className="tree-match-meta">
        <span>第 {node.match.matchNumber} 场</span>
        <span>{roundName(node.round)}</span>
      </div>
      <TeamLine team={node.match.home} score={node.result?.homeScore} probability={node.prediction?.blended.home ?? null} status={lineStatus("home", winner, favorite, state)} />
      <TeamLine team={node.match.away} score={node.result?.awayScore} probability={node.prediction?.blended.away ?? null} status={lineStatus("away", winner, favorite, state)} />
      <div className="tree-match-note">{matchNote(node, favorite)}</div>
    </article>
  );
}

function TeamLine({
  team,
  score,
  probability,
  status
}: {
  team: string;
  score?: number;
  probability: number | null;
  status: "winner" | "eliminated" | "favorite" | "neutral";
}) {
  const placeholder = !isRealTeam(team);
  return (
    <div className={`tree-team is-${status}${placeholder ? " is-placeholder" : ""}`}>
      <span className="team-name">
        <span className="team-flag" aria-hidden="true">{teamCode(team)}</span>
        <span>{displayTeam(team)}</span>
      </span>
      <span className="team-value">{score == null ? (probability == null ? "待定" : pct(probability)) : score}</span>
    </div>
  );
}

function buildNode(
  match: Fixture,
  overrideMap: Map<string, OverrideResult>,
  oddsMap: ReturnType<typeof oddsQuotesByMatchMap>,
  teamInputs: Awaited<ReturnType<typeof readTeamInputs>>,
  overrides: OverrideResult[],
  contextMap: Map<string, MatchContextInput>
): MatchNode {
  const prediction = isPlayable(match)
    ? predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides })
    : null;
  const scoreTopScores = !prediction
    ? []
    : match.matchNumber < HYBRID_SCORE_START_MATCH
      ? topScorelines(prediction.xgHome, prediction.xgAway, 3, favoriteSide(prediction.blended) ?? undefined)
      : compareModelVersions(match, oddsMap.get(match.id) ?? null, teamInputs, prediction, contextMap.get(match.id) ?? null).versions
        .find((version) => version.version === "hybrid-v2-knockout")?.topScorelines.slice(0, 3) ?? [];
  return {
    match,
    round: roundFromMatchNumber(match.matchNumber),
    result: overrideMap.get(match.id),
    prediction,
    scoreTopScores
  };
}

function groupRounds(nodes: MatchNode[]): Record<RoundKey, MatchNode[]> {
  return {
    R32: nodes.filter((node) => node.round === "R32"),
    R16: nodes.filter((node) => node.round === "R16"),
    QF: nodes.filter((node) => node.round === "QF"),
    SF: nodes.filter((node) => node.round === "SF"),
    Final: nodes.filter((node) => node.round === "Final")
  };
}

function splitRound(nodes: MatchNode[]): { left: MatchNode[]; right: MatchNode[] } {
  const midpoint = Math.ceil(nodes.length / 2);
  return { left: nodes.slice(0, midpoint), right: nodes.slice(midpoint) };
}

function roundFromMatchNumber(matchNumber: number): RoundKey {
  if (matchNumber <= 72) return "R32";
  if (matchNumber <= 88) return "R32";
  if (matchNumber <= 96) return "R16";
  if (matchNumber <= 100) return "QF";
  if (matchNumber <= 102) return "SF";
  return "Final";
}

function favoriteLabel(home: string, away: string, side: "home" | "draw" | "away"): string {
  if (side === "home") return `${teamName(home)}胜`;
  if (side === "away") return `${teamName(away)}胜`;
  return "平局";
}

function isPlayable(match: Fixture): boolean {
  return isRealTeam(match.home) && isRealTeam(match.away);
}

function isRealTeam(team: string | undefined): boolean {
  return Boolean(team && team !== "TBD" && !/^(Winner|Loser) Match \d+$/.test(team));
}

function displayTeam(team: string): string {
  if (isRealTeam(team)) return teamName(team);
  if (team === "TBD") return "待定";
  return bracketLabel(team);
}

function resultWinner(result?: OverrideResult): "home" | "away" | "draw" | null {
  if (!result) return null;
  if (result.homeScore > result.awayScore) return "home";
  if (result.awayScore > result.homeScore) return "away";
  return "draw";
}

function favoriteSide(probs: { home: number; draw: number; away: number } | null): "home" | "away" | "draw" | null {
  if (!probs) return null;
  if (probs.home >= probs.away && probs.home >= probs.draw) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function lineStatus(
  side: "home" | "away",
  winner: "home" | "away" | "draw" | null,
  favorite: "home" | "away" | "draw" | null,
  state: "complete" | "future" | "pending"
): "winner" | "eliminated" | "favorite" | "neutral" {
  if (winner === side) return "winner";
  if (winner && winner !== "draw") return "eliminated";
  if (state === "future" && favorite === side) return "favorite";
  return "neutral";
}

function matchNote(node: MatchNode, favorite: "home" | "away" | "draw" | null): string {
  if (node.result) return `实际比分 ${node.result.homeScore}-${node.result.awayScore}`;
  if (!node.prediction || !favorite || favorite === "draw") return "待定对阵 / 等待赛程确认";
  const team = favorite === "home" ? node.match.home : node.match.away;
  return `预测晋级倾向 ${teamName(team)} ${pct(node.prediction.blended[favorite])}`;
}

function hitStats(rows: MatchNode[]): { total: number; sideHits: number; scoreHits: number; scoreTotal: number } {
  let total = 0;
  let sideHits = 0;
  let scoreHits = 0;
  let scoreTotal = 0;
  for (const row of rows) {
    if (!row.result || !row.prediction) continue;
    total += 1;
    const side = favoriteSide(row.prediction.blended);
    const actual = row.result.homeScore > row.result.awayScore ? "home" : row.result.homeScore < row.result.awayScore ? "away" : "draw";
    if (side === actual) sideHits += 1;
    const actualScore = normalTimeScore(row.result);
    if (actualScore) {
      scoreTotal += 1;
      if (row.scoreTopScores.some((score) => score.score === actualScore)) scoreHits += 1;
    }
  }
  return { total, sideHits, scoreHits, scoreTotal };
}

function normalTimeScore(result?: OverrideResult): string | null {
  if (result?.normalTimeHomeScore == null || result.normalTimeAwayScore == null) return null;
  return `${result.normalTimeHomeScore}-${result.normalTimeAwayScore}`;
}

function formatHitStat(hits: number, total: number): string {
  return total ? `${hits}/${total}=${pct(hits / total)}` : "暂无";
}
