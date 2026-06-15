import { ProbabilityBar } from "@/components/ProbabilityBar";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { pct } from "@/lib/format";
import { bracketLabel, roundName, teamName } from "@/lib/i18n";
import { runSimulation } from "@/lib/simulation";

export const dynamic = "force-dynamic";

export default async function BracketPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const simulation = runSimulation(overrides, odds, teamInputs, 10000);
  const top = Object.entries(simulation.teams)
    .sort((a, b) => b[1].champion - a[1].champion)
    .slice(0, 12);
  const rounds = ["R32", "R16", "QF", "SF", "Final"] as const;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>淘汰赛路径</h1>
          <p>32 强对阵使用 FIFA 公布的候选组框架；涉及最佳第三名时，v1 按候选范围内的当前排序分配。</p>
        </div>
        <span className="pill">10,000 次模拟</span>
      </section>

      <section className="panel">
        <h2>预测淘汰赛签表</h2>
        <div className="bracket-grid">
          {rounds.map((round) => (
            <div key={round} className="bracket-round">
              <h3>{roundName(round)}</h3>
              {simulation.projectedBracket
                .filter((match) => match.round === round)
                .map((match) => (
                  <div key={match.id} className="bracket-match">
                    <strong>第 {match.id} 场</strong>
                    <div className="bracket-team">
                      <span>{match.homeTeam ? teamName(match.homeTeam) : bracketLabel(match.homeLabel)}</span>
                    </div>
                    <div className="bracket-team">
                      <span>{match.awayTeam ? teamName(match.awayTeam) : bracketLabel(match.awayLabel)}</span>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>夺冠与深轮次概率</h2>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>球队</th>
                <th>32强</th>
                <th>16强</th>
                <th>8强</th>
                <th>4强</th>
                <th>决赛</th>
                <th>冠军</th>
              </tr>
            </thead>
            <tbody>
              {top.map(([team, row]) => (
                <tr key={team}>
                  <td className="team">{teamName(team)}</td>
                  <td>{pct(row.roundOf32)}</td>
                  <td>{pct(row.roundOf16)}</td>
                  <td>{pct(row.quarterFinal)}</td>
                  <td>{pct(row.semiFinal)}</td>
                  <td>{pct(row.final)}</td>
                  <td>{pct(row.champion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid-3" style={{ marginTop: 14 }}>
          {top.slice(0, 6).map(([team, row]) => (
            <ProbabilityBar key={team} label={`${teamName(team)}夺冠`} value={row.champion} tone="green" />
          ))}
        </div>
      </section>
    </>
  );
}
