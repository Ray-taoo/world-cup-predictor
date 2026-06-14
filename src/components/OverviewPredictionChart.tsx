import { pct } from "@/lib/format";
import { bracketLabel, teamName } from "@/lib/i18n";
import { modelProbabilities } from "@/lib/model";
import type { BracketMatch, SimulationResult } from "@/lib/types";
import { Trophy } from "lucide-react";

export function OverviewPredictionChart({
  bracket,
  simulation
}: {
  bracket: BracketMatch[];
  simulation: SimulationResult;
}) {
  const r32 = bracket.filter((match) => match.round === "R32");
  const left = r32.slice(0, 8);
  const right = r32.slice(8, 16);
  const champion = Object.entries(simulation.teams).sort((a, b) => b[1].champion - a[1].champion)[0];
  const finalists = Object.entries(simulation.teams)
    .sort((a, b) => b[1].final - a[1].final)
    .slice(0, 4);
  const semis = Object.entries(simulation.teams)
    .sort((a, b) => b[1].semiFinal - a[1].semiFinal)
    .slice(0, 4);

  return (
    <section className="overview-board" aria-label="世界杯对战胜负预测总览图">
      <div className="board-glow left" />
      <div className="board-glow right" />
      <div className="board-header">
        <div>
          <span className="board-kicker">2026 世界杯</span>
          <h2>对战胜负预测总览图</h2>
        </div>
        <span className="board-badge">基于 10,000 次模拟</span>
      </div>
      <div className="board-content">
        <div className="path-column">
          <h3>左半区晋级路线</h3>
          {left.map((match) => (
            <BracketTile key={match.id} match={match} />
          ))}
        </div>

        <div className="center-stage">
          <div className="trophy">
            <Trophy size={42} aria-hidden="true" />
          </div>
          <span>预测冠军</span>
          <strong>{teamName(champion?.[0])}</strong>
          <em>{pct(champion?.[1].champion ?? 0)}</em>
          <div className="mini-grid">
            <div>
              <b>决赛热门</b>
              {finalists.map(([team, row]) => (
                <p key={team}>
                  {teamName(team)} {pct(row.final)}
                </p>
              ))}
            </div>
            <div>
              <b>四强热门</b>
              {semis.map(([team, row]) => (
                <p key={team}>
                  {teamName(team)} {pct(row.semiFinal)}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="path-column">
          <h3>右半区晋级路线</h3>
          {right.map((match) => (
            <BracketTile key={match.id} match={match} align="right" />
          ))}
        </div>
      </div>
    </section>
  );
}

function BracketTile({ match, align = "left" }: { match: BracketMatch; align?: "left" | "right" }) {
  const home = teamName(match.homeTeam) || bracketLabel(match.homeLabel);
  const away = teamName(match.awayTeam) || bracketLabel(match.awayLabel);
  const prediction = predictedWinner(match.homeTeam, match.awayTeam);
  return (
    <div className={`board-match ${align}`}>
      <span>第 {match.id} 场</span>
      <strong>
        {home} 对 {away}
      </strong>
      <em>
        预计：{prediction.name} 晋级 {pct(prediction.probability)}
      </em>
    </div>
  );
}

function predictedWinner(home?: string, away?: string): { name: string; probability: number } {
  if (!home && !away) return { name: "待定", probability: 0 };
  if (!home) return { name: teamName(away), probability: 1 };
  if (!away) return { name: teamName(home), probability: 1 };
  const probabilities = modelProbabilities(home, away);
  const homeAdvance = probabilities.home + probabilities.draw * 0.5;
  if (homeAdvance >= 0.5) return { name: teamName(home), probability: homeAdvance };
  return { name: teamName(away), probability: 1 - homeAdvance };
}
