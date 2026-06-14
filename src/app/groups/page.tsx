import { ProbabilityBar } from "@/components/ProbabilityBar";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { number, pct } from "@/lib/format";
import { groupName, teamName } from "@/lib/i18n";
import { runSimulation } from "@/lib/simulation";
import { bestThirds, groupStandings } from "@/lib/standings";

export default async function GroupsPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const standings = groupStandings(overrides, odds, teamInputs);
  const thirds = bestThirds(standings);
  const simulation = runSimulation(overrides, odds, teamInputs, 10000);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>小组积分与出线概率</h1>
          <p>未完成比赛用期望积分展示；手动锁定比分后按真实积分进入排序。</p>
        </div>
        <span className="pill">10,000 次模拟</span>
      </section>

      <section className="grid-3">
        {data.groups.map((group) => (
          <div key={group.id} className="panel">
            <h2>{groupName(group.id)}</h2>
            <div className="table-wrap">
              <table suppressHydrationWarning>
                <thead>
                  <tr>
                    <th>队</th>
                    <th>分</th>
                    <th>净胜</th>
                    <th>出线</th>
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
                      <td>{pct(simulation.teams[row.team]?.roundOf32 ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {standings[group.id].slice(0, 4).map((row) => (
              <ProbabilityBar key={row.team} label={`${teamName(row.team)}进32强`} value={simulation.teams[row.team]?.roundOf32 ?? 0} />
            ))}
          </div>
        ))}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>最佳第三名排序</h2>
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
    </>
  );
}
