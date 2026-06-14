import { BankrollPlan } from "@/components/BankrollPlan";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { OverviewPredictionChart } from "@/components/OverviewPredictionChart";
import { data, orderedTeams } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { beijingMatchTime, dateTime, pct } from "@/lib/format";
import { groupName, teamName, venueName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { matchReason } from "@/lib/reasons";
import { stakeSeedsFromCandidates, topBuyingCandidates, type BuyingCandidate } from "@/lib/selection";
import { runSimulation } from "@/lib/simulation";
import { readNightlyRefreshState, type NightlyRefreshState } from "@/lib/nightly-refresh";
import {
  strategyStatFromBacktests
} from "@/lib/risk";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import type { MatchPrediction, OverrideResult } from "@/lib/types";

export default async function HomePage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const simulation = runSimulation(overrides, odds, teamInputs, 10000);
  const championTable = Object.entries(simulation.teams)
    .sort((a, b) => b[1].champion - a[1].champion)
    .slice(0, 8);
  const allPredictions = data.fixtures
    .map((match) => predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs))
    .sort(comparePredictionTime);
  const upcomingPredictions = allPredictions.filter((prediction) => !overrideMap.has(prediction.match.id));
  const completedPredictions = allPredictions.filter((prediction) => overrideMap.has(prediction.match.id));
  const strategyStats = [
    strategyStatFromBacktests(data.backtests, "55%+", "highConfidence55Matches", "highConfidence55Accuracy"),
    strategyStatFromBacktests(data.backtests, "60%+", "highConfidence60Matches", "highConfidence60Accuracy")
  ];
  const tomorrowPredictions = upcomingPredictions.filter(isTomorrowBeijing);
  const planPredictions = tomorrowPredictions.length ? tomorrowPredictions : upcomingPredictions.slice(0, 8);
  const stakeCandidates = topBuyingCandidates(planPredictions, 48, odds).sort(compareCandidateTime);
  const stakeSeeds = stakeSeedsFromCandidates(stakeCandidates);
  const nightlyRefresh = readNightlyRefreshState();
  const topMatches = upcomingPredictions.slice(0, 10);
  const safestMatches = [...upcomingPredictions]
    .filter((prediction) => prediction.recommendationLevel !== "观望")
    .sort((a, b) => a.match.sortDate.localeCompare(b.match.sortDate) || maxProbability(b) - maxProbability(a))
    .slice(0, 5);
  const riskyMatches = [...upcomingPredictions]
    .sort((a, b) => a.match.sortDate.localeCompare(b.match.sortDate) || maxProbability(a) - maxProbability(b))
    .slice(0, 5);
  const topElo = orderedTeams().slice(0, 6);
  const latestOdds = odds[0]?.fetchedAt;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>2026 世界杯预测总览</h1>
        </div>
        <span className={odds.length ? "pill ok" : "pill warning"}>{odds.length ? "已接入赔率" : "未接入实时盘口"}</span>
      </section>

      <OverviewPredictionChart bracket={simulation.projectedBracket} simulation={simulation} />

      <section className="status-strip">
        <div className="metric">
          <span>数据快照</span>
          <strong>{dateTime(data.generatedAt)}</strong>
        </div>
        <div className="metric">
          <span>赛程</span>
          <strong>{data.fixtures.length} 场</strong>
        </div>
        <div className="metric">
          <span>已锁定赛果</span>
          <strong>{overrides.length} 场</strong>
        </div>
        <div className="metric">
          <span>赔率记录</span>
          <strong>{odds.length}</strong>
        </div>
      </section>

      <NightlyRefreshPanel state={nightlyRefresh} />

      {completedPredictions.length ? (
        <section className="panel postmatch-panel" style={{ marginBottom: 16 }}>
          <div className="section-title-row">
            <div>
              <h2>已结束比赛赛果与赛后复盘</h2>
              <p className="muted">运行刷新后会先自动更新已结束赛果；这里记录预测和实际差别，后续用来修正模型。</p>
            </div>
            <span className="pill ok">自动复盘</span>
          </div>
          <div className="compact-list">
            {completedPredictions.map((prediction) => (
              <PostMatchReview key={prediction.match.id} prediction={prediction} override={overrideMap.get(prediction.match.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <BankrollPlan seeds={stakeSeeds} strategyStats={strategyStats} />

      <section className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>今日最稳场次</h2>
          <div className="compact-list">
            {(safestMatches.length ? safestMatches : allPredictions.slice(0, 5)).map((prediction) => (
              <PredictionMini key={prediction.match.id} prediction={prediction} />
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>风险最大场次</h2>
          <div className="compact-list">
            {riskyMatches.map((prediction) => (
              <PredictionMini key={prediction.match.id} prediction={prediction} />
            ))}
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <h2>夺冠概率前 8</h2>
          <div className="match-list">
            {championTable.map(([team, result], index) => (
              <div key={team}>
                <div className="prob-label">
                  <span>
                    {index + 1}. <span className="team">{teamName(team)}</span>
                  </span>
                  <strong>{pct(result.champion)}</strong>
                </div>
                <ProbabilityBar label="夺冠" value={result.champion} tone={index < 3 ? "green" : "blue"} />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>模型实力前 6</h2>
          <div className="table-wrap">
            <table suppressHydrationWarning>
              <thead>
                <tr>
                  <th>球队</th>
                  <th>组</th>
                  <th>强度分</th>
                  <th>近10场</th>
                </tr>
              </thead>
              <tbody>
                {topElo.map((team) => (
                  <tr key={team.name}>
                    <td className="team">{teamName(team.name)}</td>
                    <td>{groupName(team.group)}</td>
                    <td>{team.elo}</td>
                    <td>
                      {team.recentForm.wins}胜 {team.recentForm.draws}平 {team.recentForm.losses}负
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>开赛初段重点比赛</h2>
        <div className="match-list">
          {topMatches.map((prediction) => (
            <div key={prediction.match.id} className="match-card">
              <div className="match-top">
                <div>
                  <div className="match-title">
                    <span>{teamName(prediction.match.home)}</span>
                    <span className="muted">对</span>
                    <span>{teamName(prediction.match.away)}</span>
                    <span className="pill">{groupName(prediction.match.group)}</span>
                  </div>
                  <div className="match-meta">
                    {beijingMatchTime(prediction.match.sortDate)} · {venueName(prediction.match.venue)} · 预计比分 {prediction.likelyScore}
                  </div>
                </div>
                <span className="pill">信心 {prediction.confidenceLabel}</span>
              </div>
              <div className="prob-grid">
                <ProbabilityBar label={`${teamName(prediction.match.home)}胜`} value={prediction.blended.home} tone="blue" />
                <ProbabilityBar label="平局" value={prediction.blended.draw} tone="amber" />
                <ProbabilityBar label={`${teamName(prediction.match.away)}胜`} value={prediction.blended.away} tone="red" />
              </div>
              <div className="match-meta">
                <strong>胜负理由：</strong>
                {matchReason(prediction)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="note" style={{ marginTop: 16 }}>
        {latestOdds
          ? `最新赔率记录时间：${dateTime(latestOdds)}。`
          : "当前没有实时盘口，预测只使用公开赛果计算的强度分、近期状态、主办国修正和进球分布模型。"}
      </p>
    </>
  );
}

function NightlyRefreshPanel({ state }: { state: NightlyRefreshState }) {
  const ok = state.status === "ok";
  return (
    <section className="panel nightly-panel" style={{ marginBottom: 16 }}>
      <div className="section-title-row">
        <div>
          <h2>21:00 赛前核对</h2>
          <p className="muted">每天晚上 9 点自动刷新明日赔率，并更新首发/伤停核对提醒。首发自动抓取暂未接入时，会明确标记为需要人工复核。</p>
        </div>
        <span className={ok ? "pill ok" : "pill warning"}>{ok ? "今晚已刷新" : "等待刷新"}</span>
      </div>
      <div className="nightly-grid">
        <div>
          <span>最近成功</span>
          <strong>{state.lastSuccessAt ? dateTime(state.lastSuccessAt) : "暂无"}</strong>
        </div>
        <div>
          <span>目标赛程日</span>
          <strong>{state.targetDate ?? "明日"}</strong>
        </div>
        <div>
          <span>赔率导入</span>
          <strong>{state.oddsImported} 条</strong>
        </div>
        <div>
          <span>缺盘口场次</span>
          <strong>{state.missingOddsMatchIds.length} 场</strong>
        </div>
        <div>
          <span>需首发复核</span>
          <strong>{state.lineupPendingMatches.length} 场</strong>
        </div>
      </div>
      <p className="note">{state.note}</p>
    </section>
  );
}

function PredictionMini({ prediction, override }: { prediction: MatchPrediction; override?: OverrideResult }) {
  const favorite = favoriteLabel(prediction);
  return (
    <div className="compact-item">
      <div>
        <strong>
          {teamName(prediction.match.home)} 对 {teamName(prediction.match.away)}
        </strong>
        <p className="muted">
          {groupName(prediction.match.group)} · {beijingMatchTime(prediction.match.sortDate)} · 推荐 {favorite} · 预计比分 {prediction.likelyScore}
        </p>
        {override ? (
          <p className="muted">
            {resultSourceLabel(override)}：{teamName(prediction.match.home)} {override.homeScore}-{override.awayScore} {teamName(prediction.match.away)}
          </p>
        ) : null}
      </div>
      <div className="compact-right">
        <span className={prediction.recommendationLevel.includes("强推荐") ? "pill ok" : "pill"}>{prediction.recommendationLevel}</span>
        <strong>{pct(maxProbability(prediction))}</strong>
      </div>
    </div>
  );
}

function PostMatchReview({ prediction, override }: { prediction: MatchPrediction; override?: OverrideResult }) {
  if (!override) return <PredictionMini prediction={prediction} />;
  const predictedSide = favoriteSide(prediction);
  const actualSide = actualOutcomeSide(override);
  const predictedProbability = prediction.blended[predictedSide];
  const actualProbability = prediction.blended[actualSide];
  const correct = predictedSide === actualSide;
  const probabilityGap = predictedProbability - actualProbability;
  return (
    <article className={`postmatch-card ${correct ? "is-correct" : "is-wrong"}`}>
      <div className="postmatch-head">
        <div>
          <strong>
            {teamName(prediction.match.home)} 对 {teamName(prediction.match.away)}
          </strong>
          <p className="muted">
            实际 {teamName(prediction.match.home)} {override.homeScore}-{override.awayScore} {teamName(prediction.match.away)} · {resultSourceLabel(override)}
          </p>
        </div>
        <span className={correct ? "result-badge ok" : "result-badge bad"}>{correct ? "预测正确" : "预测错误"}</span>
      </div>
      <div className="review-compare">
        <span>
          预测 <strong>{outcomeLabel(predictedSide, prediction)} {pct(predictedProbability)}</strong>
        </span>
        <span className="compare-arrow">→</span>
        <span>
          实际 <strong>{outcomeLabel(actualSide, prediction)} {pct(actualProbability)}</strong>
        </span>
        <span className={correct ? "edge-positive" : "edge-negative"}>偏差 {pct(Math.abs(probabilityGap))}</span>
        <span>预计比分 {prediction.likelyScore}</span>
      </div>
      <div className="review-notes">
        <p>
          <strong>复盘：</strong>
          {postMatchReflection(prediction, override, predictedSide, actualSide, correct)}
        </p>
        <p>
          <strong>改进：</strong>
          {postMatchImprovement(prediction, predictedSide, actualSide, correct)}
        </p>
      </div>
    </article>
  );
}

function comparePredictionTime(a: MatchPrediction, b: MatchPrediction): number {
  return a.match.sortDate.localeCompare(b.match.sortDate) || a.match.matchNumber - b.match.matchNumber;
}

function compareCandidateTime(a: BuyingCandidate, b: BuyingCandidate): number {
  return a.prediction.match.sortDate.localeCompare(b.prediction.match.sortDate) || a.prediction.match.matchNumber - b.prediction.match.matchNumber;
}

function isTomorrowBeijing(prediction: MatchPrediction): boolean {
  return beijingDateKey(prediction.match.sortDate) === beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

function beijingDateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function resultSourceLabel(override: OverrideResult): string {
  return override.note?.startsWith("自动抓取赛果") ? "已自动更新赛果" : "已手动锁定赛果";
}

function maxProbability(prediction: MatchPrediction): number {
  return Math.max(prediction.blended.home, prediction.blended.draw, prediction.blended.away);
}

function favoriteSide(prediction: MatchPrediction): "home" | "draw" | "away" {
  const { blended } = prediction;
  if (blended.home >= blended.draw && blended.home >= blended.away) return "home";
  if (blended.away >= blended.draw) return "away";
  return "draw";
}

function favoriteLabel(prediction: MatchPrediction): string {
  return outcomeLabel(favoriteSide(prediction), prediction);
}

function actualOutcomeSide(override: OverrideResult): "home" | "draw" | "away" {
  if (override.homeScore > override.awayScore) return "home";
  if (override.homeScore < override.awayScore) return "away";
  return "draw";
}

function outcomeLabel(side: "home" | "draw" | "away", prediction: MatchPrediction): string {
  if (side === "home") return `${teamName(prediction.match.home)}胜`;
  if (side === "away") return `${teamName(prediction.match.away)}胜`;
  return "平局";
}

function postMatchReflection(
  prediction: MatchPrediction,
  override: OverrideResult,
  predictedSide: "home" | "draw" | "away",
  actualSide: "home" | "draw" | "away",
  correct: boolean
): string {
  if (correct) {
    return `方向正确，模型给 ${outcomeLabel(predictedSide, prediction)} 的概率为 ${pct(prediction.blended[predictedSide])}。这类样本会作为后续校准高信心比赛的正样本。`;
  }
  if (actualSide === "draw") {
    return `本场打平，模型赛前更偏向 ${outcomeLabel(predictedSide, prediction)}，说明平局风险可能被低估，尤其是强弱差不够大或盘口优势不明显时。`;
  }
  const actualWasUnderdog = prediction.blended[actualSide] < prediction.blended[predictedSide];
  if (actualWasUnderdog) {
    return `实际结果落在低概率方向，模型可能高估热门方稳定性，或低估了临场阵容、战术保守、早段进球等单场波动。`;
  }
  return `预测方向和实际方向不一致，主要偏差来自模型概率排序与比赛实际走势不一致，需要结合盘口变化和临场信息复核。`;
}

function postMatchImprovement(
  prediction: MatchPrediction,
  predictedSide: "home" | "draw" | "away",
  actualSide: "home" | "draw" | "away",
  correct: boolean
): string {
  if (correct) return "保留当前权重，但继续观察同类比赛是否存在过度自信；若连续命中，可提高相似盘口的信任度。";
  const top = prediction.blended[predictedSide];
  if (top >= 0.65) return "降低高概率结果的过度自信，赛前重点检查首发、伤停和盘口是否反向移动。";
  if (actualSide === "draw") return "提高平局保护权重；在 1X2 差距不大时，2串1优先使用胜平或平负双选。";
  return "加入临场盘口漂移和阵容核对后再给最终买入；盘口与模型不一致时降低推荐等级。";
}
