import { data } from "@/lib/data";
import { AutoRefreshOnOpen } from "@/components/AutoRefreshOnOpen";
import { FullRefreshButton } from "@/components/FullRefreshButton";
import { ScorelineChips } from "@/components/ScorelineChips";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { beijingMatchTime, dateTime, pct } from "@/lib/format";
import { teamName } from "@/lib/i18n";
import { buildModelIterationState, buildModelReviewRows } from "@/lib/model-iteration";
import { predictionForMatch } from "@/lib/model";
import { expectedNightlyTargetDate, isNightlyRefreshStale, readNightlyRefreshState } from "@/lib/nightly-refresh";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import type { ModelReviewRow, OutcomeKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const iteration = buildModelIterationState(overrides, odds, teamInputs);
  const rows = buildModelReviewRows(overrides, odds, teamInputs);
  const refreshState = readNightlyRefreshState();
  const expectedTargetDate = expectedNightlyTargetDate();
  const shouldAutoRefresh = isNightlyRefreshStale(refreshState);
  const oddsMap = oddsQuotesByMatchMap(odds);
  const pendingResults = data.fixtures
    .filter((match) => !overrides.some((override) => override.matchId === match.id) && new Date(match.sortDate).getTime() <= Date.now())
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .map((match) => ({
      match,
      prediction: predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { iteration, overrides })
    }));
  const upcoming = data.fixtures
    .filter((match) => !overrides.some((override) => override.matchId === match.id) && new Date(match.sortDate).getTime() > Date.now())
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .slice(0, 6)
    .map((match) => ({
      match,
      before: predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides }),
      after: predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { iteration, overrides })
    }));

  return (
    <>
      <section className="page-head">
        <div>
          <h1>赛后复盘与模型迭代</h1>
          <p>每天刷新赛果后，这里会把预测和实际结果对比，并把错误类型转成下一轮模型参数。</p>
          <div style={{ marginTop: 12 }}>
            <FullRefreshButton />
          </div>
        </div>
        <span className={iteration.sampleSize >= 6 ? "pill ok" : "pill warning"}>{iteration.sampleSize >= 6 ? "自动迭代已开启" : "样本积累中"}</span>
      </section>

      <AutoRefreshOnOpen enabled={shouldAutoRefresh} targetDate={expectedTargetDate} />

      <section className="status-strip review-status">
        <div className="metric">
          <span>刷新状态</span>
          <strong>{refreshState.status === "ok" ? "正常" : "待检查"}</strong>
        </div>
        <div className="metric">
          <span>最近刷新</span>
          <strong>{refreshState.lastSuccessAt ? dateTime(refreshState.lastSuccessAt) : "暂无"}</strong>
        </div>
        <div className="metric">
          <span>已学习样本</span>
          <strong>{iteration.sampleSize} 场</strong>
        </div>
        <div className="metric">
          <span>首选命中率</span>
          <strong>{iteration.sampleSize ? pct(iteration.accuracy) : "暂无"}</strong>
        </div>
      </section>

      <section className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="section-title-row">
            <div>
              <h2>本轮复盘结论</h2>
              <p className="muted">这些结论会直接影响未来比赛的概率，而不是只做文字记录。</p>
            </div>
            <span className="pill">Brier {iteration.sampleSize ? iteration.brier.toFixed(3) : "暂无"}</span>
          </div>
          <div className="review-grid">
            <div>
              <span>平局漏判</span>
              <strong>{iteration.drawMisses} 场</strong>
            </div>
            <div>
              <span>高信心错判</span>
              <strong>{iteration.overconfidentWrong} 场</strong>
            </div>
            <div>
              <span>爆冷错判</span>
              <strong>{iteration.upsetWrong} 场</strong>
            </div>
            <div>
              <span>Log loss</span>
              <strong>{iteration.sampleSize ? iteration.logLoss.toFixed(3) : "暂无"}</strong>
            </div>
          </div>
          <div className="iteration-adjustments">
            <span>模型温度 {iteration.adjustments.modelTemperature.toFixed(3)}</span>
            <span>平局保护 +{pct(iteration.adjustments.drawBoost)}</span>
            <span>热门降温 {pct(iteration.adjustments.favoriteShrink)}</span>
            <span>盘口权重 {iteration.adjustments.marketWeightShift >= 0 ? "+" : ""}{pct(iteration.adjustments.marketWeightShift)}</span>
          </div>
          <div className="compact-list">
            {iteration.notes.map((note) => (
              <div key={note} className="compact-item">
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>迭代前后影响</h2>
          <p className="muted">最近未开赛场次在复盘学习前后的首选概率变化。</p>
          <div className="compact-list">
            {upcoming.map(({ match, before, after }) => {
              const beforeSide = favoriteSide(before.blended);
              const afterSide = favoriteSide(after.blended);
              return (
                <div key={match.id} className="compact-item">
                  <div>
                    <strong>
                      {teamName(match.home)} 对 {teamName(match.away)}
                    </strong>
                    <p className="muted">{beijingMatchTime(match.sortDate)}</p>
                  </div>
                  <div className="compact-right">
                    <span>{outcomeLabel(beforeSide, match.home, match.away)} {pct(before.blended[beforeSide])}</span>
                    <strong>{outcomeLabel(afterSide, match.home, match.away)} {pct(after.blended[afterSide])}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="note">如果平局漏判和热门错判继续增加，系统会继续降低热门方概率；单场预测会优先降级为观望，并要求比分区同步复核低比分和平局风险。</p>
        </div>
      </section>

      {pendingResults.length ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="section-title-row">
            <div>
              <p className="muted">赛果同步失败，正在重试。</p>
              <h2>等待赛果更新</h2>
              <p className="muted">这些比赛已经开赛或结束，后台同步任务尚未取得最终比分；取得赛果后会自动进入下方复盘明细。</p>
            </div>
            <span className="pill warning">{pendingResults.length} 场</span>
          </div>
          <div className="compact-list">
            {pendingResults.slice(0, 8).map(({ match, prediction }) => {
              const side = favoriteSide(prediction.blended);
              return (
              <div key={match.id} className="compact-item">
                <div>
                  <strong>{teamName(match.home)} 对 {teamName(match.away)}</strong>
                  <p className="muted">
                    {beijingMatchTime(match.sortDate)}
                    <ScorelineChips homeXg={prediction.xgHome} awayXg={prediction.xgAway} preferred={match.stage === "group" ? side : undefined} />
                  </p>
                </div>
                <div className="compact-right">
                  <span>赛前方向</span>
                  <strong>{outcomeLabel(side, match.home, match.away)} {pct(prediction.blended[side])}</strong>
                </div>
              </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title-row">
          <div>
            <h2>已完赛样本明细</h2>
            <p className="muted">绿色为预测正确，红色为预测错误；错误类型会进入下一轮模型调整。</p>
          </div>
          <span className="pill">{rows.length} 场</span>
        </div>
        <div className="table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th>比赛</th>
                <th>实际</th>
                <th>预测</th>
                <th>结果</th>
                <th>错误类型</th>
                <th>反思原因</th>
                <th>盘口源</th>
                <th>Brier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ReviewTableRow key={row.matchId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ReviewTableRow({ row }: { row: ModelReviewRow }) {
  return (
    <tr>
      <td>
        <strong>{teamName(row.home)} 对 {teamName(row.away)}</strong>
        <div className="muted">{beijingMatchTime(row.sortDate)}</div>
      </td>
      <td>
        {row.actualScore}
        <div className="muted">{outcomeLabel(row.actual, row.home, row.away)} {pct(row.actualProbability)}</div>
      </td>
      <td>
        {outcomeLabel(row.predicted, row.home, row.away)} {pct(row.predictedProbability)}
        <div className="muted">
          <ScorelineChips scores={row.topScorelines} />
        </div>
      </td>
      <td>
        <span className={row.correct ? "result-badge ok" : "result-badge bad"}>{row.correct ? "正确" : "错误"}</span>
      </td>
      <td>{row.reflectionType}</td>
      <td className="muted">{row.reflectionDetail}</td>
      <td>{row.providerCount ? `${row.providerCount} 家` : "无盘口"}</td>
      <td>{row.brier.toFixed(3)}</td>
    </tr>
  );
}

function favoriteSide(probs: { home: number; draw: number; away: number }): OutcomeKey {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function outcomeLabel(side: OutcomeKey, home: string, away: string): string {
  if (side === "home") return `${teamName(home)}胜`;
  if (side === "away") return `${teamName(away)}胜`;
  return "平局";
}
