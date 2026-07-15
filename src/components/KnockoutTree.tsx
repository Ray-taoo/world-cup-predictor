import { Trophy } from "lucide-react";

import { pct } from "@/lib/format";
import { bracketLabel, roundName, teamCode, teamName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import type { Fixture, ModelIterationState, OddsQuote, OverrideResult, TeamInput } from "@/lib/types";

type RoundKey = "R32" | "R16" | "QF" | "SF" | "Final";
type Advance = { team: string; probability: number };
type TreeNode = {
  match: Fixture;
  round: RoundKey;
  result?: OverrideResult;
  prediction: ReturnType<typeof predictionForMatch> | null;
  advance: Advance | null;
};

const roundOrder: RoundKey[] = ["R32", "R16", "QF", "SF"];

export function KnockoutTree({ fixtures, overrides, odds, teamInputs, iteration }: {
  fixtures: Fixture[];
  overrides: OverrideResult[];
  odds: OddsQuote[];
  teamInputs: TeamInput[];
  iteration?: ModelIterationState | null;
}) {
  const nodes = buildNodes(fixtures, overrides, odds, teamInputs, iteration);
  const byRound = groupRounds(nodes);
  const leftRounds = Object.fromEntries(roundOrder.map((round) => [round, splitRound(byRound[round]).left])) as Record<RoundKey, TreeNode[]>;
  const rightRounds = Object.fromEntries(roundOrder.map((round) => [round, splitRound(byRound[round]).right])) as Record<RoundKey, TreeNode[]>;
  const finalNode = byRound.Final.find((node) => node.match.matchNumber === 104) ?? byRound.Final[0] ?? null;

  return (
    <section className="knockout-panel overview-knockout" aria-label="淘汰赛对阵图">
      <div className="knockout-map">
        <BracketSide side="left" rounds={roundOrder} byRound={leftRounds} />
        <ChampionCenter champion={finalNode?.advance ?? null} finalNode={finalNode} />
        <BracketSide side="right" rounds={[...roundOrder].reverse()} byRound={rightRounds} />
      </div>
    </section>
  );
}

function BracketSide({ side, rounds, byRound }: { side: "left" | "right"; rounds: RoundKey[]; byRound: Record<RoundKey, TreeNode[]> }) {
  return <div className={`bracket-side bracket-side-${side}`}>
    {rounds.map((round) => <div key={round} className={`tree-round tree-round-${round.toLowerCase()}`}>
      <h2>{roundName(round)}</h2>
      <div className="tree-match-list">{byRound[round].map((node) => <MatchCard key={node.match.id} node={node} side={side} />)}</div>
    </div>)}
  </div>;
}

function ChampionCenter({ champion, finalNode }: { champion: Advance | null; finalNode: TreeNode | null }) {
  return <aside className="champion-center" aria-label="冠军预测">
    <div className="trophy-mark" aria-hidden="true"><Trophy size={42} strokeWidth={1.8} /></div>
    <span className="center-kicker">图内路径冠军</span>
    <strong>{champion ? teamName(champion.team) : "待定"}</strong>
    <em>{champion ? pct(champion.probability) : "暂无"}</em>
    {finalNode ? <MatchCard node={finalNode} side="center" compact /> : null}
    <div className="center-info-grid"><div>
      <b>决赛路径</b>
      <p><span>{finalNode ? `${teamCode(finalNode.match.home)} ${displayTeam(finalNode.match.home)} vs ${teamCode(finalNode.match.away)} ${displayTeam(finalNode.match.away)}` : "待定"}</span></p>
      {champion ? <p><span>冠军</span><strong>{teamName(champion.team)} {pct(champion.probability)}</strong></p> : null}
    </div></div>
  </aside>;
}

function MatchCard({ node, side, compact = false }: { node: TreeNode; side: "left" | "right" | "center"; compact?: boolean }) {
  const winner = resultWinner(node.result);
  const state = node.result ? "complete" : isPlayable(node.match) ? "future" : "pending";
  return <article className={`tree-match tree-match-${side} is-${state}${compact ? " is-compact" : ""}`}>
    <div className="tree-match-meta"><span>第 {node.match.matchNumber} 场</span><span>{roundName(node.round)}</span></div>
    <TeamLine side="home" team={node.match.home} score={node.result?.homeScore} advance={node.advance} winner={winner} state={state} />
    <TeamLine side="away" team={node.match.away} score={node.result?.awayScore} advance={node.advance} winner={winner} state={state} />
    <div className="tree-match-note">{matchNote(node)}</div>
  </article>;
}

function TeamLine({ side, team, score, advance, winner, state }: { side: "home" | "away"; team: string; score?: number; advance: Advance | null; winner: "home" | "away" | "draw" | null; state: "complete" | "future" | "pending" }) {
  const isFavorite = advance?.team === team;
  const status = winner ? (winner === side ? "winner" : winner === "draw" ? "neutral" : "eliminated") : state === "future" && isFavorite ? "favorite" : "neutral";
  const probability = advance ? (isFavorite ? advance.probability : 1 - advance.probability) : null;
  const placeholder = !isRealTeam(team);
  return <div className={`tree-team is-${status}${placeholder ? " is-placeholder" : ""}`}>
    <span className="team-name"><span className="team-flag" aria-hidden="true">{teamCode(team)}</span><span>{displayTeam(team)}</span></span>
    <span className="team-value">{score == null ? (probability == null ? "待定" : pct(probability)) : score}</span>
  </div>;
}

function buildNodes(fixtures: Fixture[], overrides: OverrideResult[], odds: OddsQuote[], teamInputs: TeamInput[], iteration?: ModelIterationState | null): TreeNode[] {
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const winners = new Map<number, string>();
  return fixtures.filter((match) => match.stage !== "group" && match.stage !== "third_place").sort((a, b) => a.matchNumber - b.matchNumber).map((fixture) => {
    const match = { ...fixture, home: resolveTeam(fixture.home, winners), away: resolveTeam(fixture.away, winners) };
    const result = overrideMap.get(match.id);
    const prediction = isPlayable(match) ? predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides }) : null;
    const advance = advanceFor(match, result, prediction);
    if (advance) winners.set(match.matchNumber, advance.team);
    return { match, round: roundFromMatchNumber(match.matchNumber), result, prediction, advance };
  });
}

function resolveTeam(team: string, winners: Map<number, string>): string {
  const matchNumber = Number(team.match(/(?:Winner|Loser)(?: Match)? (\d+)/)?.[1]);
  return Number.isFinite(matchNumber) ? winners.get(matchNumber) ?? team : team;
}

function advanceFor(match: Fixture, result: OverrideResult | undefined, prediction: ReturnType<typeof predictionForMatch> | null): Advance | null {
  if (result && result.homeScore !== result.awayScore) return { team: result.homeScore > result.awayScore ? match.home : match.away, probability: 1 };
  if (!prediction) return null;
  const homeProbability = prediction.blended.home + prediction.blended.draw * 0.5;
  return homeProbability >= 0.5 ? { team: match.home, probability: homeProbability } : { team: match.away, probability: 1 - homeProbability };
}

function groupRounds(nodes: TreeNode[]): Record<RoundKey, TreeNode[]> {
  return { R32: nodes.filter((node) => node.round === "R32"), R16: nodes.filter((node) => node.round === "R16"), QF: nodes.filter((node) => node.round === "QF"), SF: nodes.filter((node) => node.round === "SF"), Final: nodes.filter((node) => node.round === "Final") };
}

function splitRound(nodes: TreeNode[]) { const midpoint = Math.ceil(nodes.length / 2); return { left: nodes.slice(0, midpoint), right: nodes.slice(midpoint) }; }
function roundFromMatchNumber(matchNumber: number): RoundKey { return matchNumber <= 88 ? "R32" : matchNumber <= 96 ? "R16" : matchNumber <= 100 ? "QF" : matchNumber <= 102 ? "SF" : "Final"; }
function isPlayable(match: Fixture): boolean { return isRealTeam(match.home) && isRealTeam(match.away); }
function isRealTeam(team: string | undefined): boolean { return Boolean(team && team !== "TBD" && !/^(Winner|Loser)(?: Match)? \d+$/.test(team)); }
function displayTeam(team: string): string { return isRealTeam(team) ? teamName(team) : team === "TBD" ? "待定" : bracketLabel(team); }
function resultWinner(result?: OverrideResult): "home" | "away" | "draw" | null { return !result ? null : result.homeScore > result.awayScore ? "home" : result.awayScore > result.homeScore ? "away" : "draw"; }
function matchNote(node: TreeNode): string { return node.result ? `实际比分 ${node.result.homeScore}-${node.result.awayScore}` : node.advance ? `预测晋级 ${teamName(node.advance.team)} ${pct(node.advance.probability)}` : "待定对阵 / 等待赛程确认"; }
