import { BankrollPlan } from "@/components/BankrollPlan";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { KnockoutTree } from "@/components/KnockoutTree";
import { AutoRefreshOnOpen } from "@/components/AutoRefreshOnOpen";
import { ScorelineChips } from "@/components/ScorelineChips";
import Link from "next/link";
import { data, orderedTeams } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { readMatchContexts } from "@/lib/match-context";
import { isCloudflareProduction } from "@/lib/cloudflare";
import { beijingMatchTime, dateTime, pct } from "@/lib/format";
import { fixtureStageName, groupName, teamName, venueName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { compareModelVersions, type ModelVariantPrediction } from "@/lib/model-variants";
import { matchReason } from "@/lib/reasons";
import { stakeSeedsFromCandidates, topBuyingCandidates, type BuyingCandidate } from "@/lib/selection";
import { runSimulation } from "@/lib/simulation";
import {
  expectedNightlyTargetDate,
  isNightlyRefreshStale,
  readNightlyRefreshState,
  type NightlyRefreshState
} from "@/lib/nightly-refresh";
import { buildModelIterationState } from "@/lib/model-iteration";
import {
  strategyStatFromBacktests
} from "@/lib/risk";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import type { MatchPrediction, ModelIterationState, OverrideResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const modelIteration = buildModelIterationState(overrides, odds, teamInputs);
  const contextMap = await readMatchContexts();
  // ponytail: Workers Free allows 10ms CPU; use a persisted simulation snapshot when richer production odds are needed.
  const simulation = isCloudflareProduction() ? null : runSimulation(overrides, odds, teamInputs, 10000, modelIteration);
  const championTable = simulation ? Object.entries(simulation.teams)
    .sort((a, b) => b[1].champion - a[1].champion)
    .slice(0, 8) : [];
  const allPredictions = data.fixtures
    .map((match) => predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { iteration: modelIteration }))
    .sort(comparePredictionTime);
  const upcomingPredictions = allPredictions.filter((prediction) => !overrideMap.has(prediction.match.id) && hasNotStarted(prediction));
  const pendingResultPredictions = allPredictions.filter((prediction) => !overrideMap.has(prediction.match.id) && !hasNotStarted(prediction));
  const completedPredictions = allPredictions.filter((prediction) => overrideMap.has(prediction.match.id));
  const recentCompletedPredictions = [...completedPredictions].sort(comparePredictionTime).slice(-4).reverse();
  const recentPendingResults = [...pendingResultPredictions].sort(comparePredictionTime).slice(0, 4);
  const strategyStats = [
    strategyStatFromBacktests(data.backtests, "55%+", "highConfidence55Matches", "highConfidence55Accuracy"),
    strategyStatFromBacktests(data.backtests, "60%+", "highConfidence60Matches", "highConfidence60Accuracy")
  ];
  const nearPredictions = upcomingPredictions.filter(isNearBeijing);
  const planPredictions = nearPredictions.length ? nearPredictions : upcomingPredictions.slice(0, 8);
  const stakeCandidates = topBuyingCandidates(planPredictions, 48, odds).sort(compareCandidateTime);
  const stakeSeeds = stakeSeedsFromCandidates(stakeCandidates);
  const topMatches = upcomingPredictions.slice(0, 10);
  const comparisonPredictions = [...new Map(
    [...topMatches, ...stakeCandidates.slice(0, 8).map((candidate) => candidate.prediction), ...recentPendingResults]
      .map((prediction) => [prediction.match.id, prediction])
  ).values()];
  const modelVersionsByMatch = new Map(
    comparisonPredictions.map((prediction) => [
      prediction.match.id,
      compareModelVersions(
        prediction.match,
        oddsMap.get(prediction.match.id) ?? null,
        teamInputs,
        prediction,
        contextMap.get(prediction.match.id) ?? null
      ).versions
    ])
  );
  const hybridVersionsByMatch = new Map(
    [...modelVersionsByMatch].flatMap(([matchId, versions]) => {
      const hybrid = versions.find((version) => version.version === "hybrid-v2-knockout");
      return hybrid ? [[matchId, hybrid] as const] : [];
    })
  );
  const hybridTopScoresByMatch = Object.fromEntries(
    [...hybridVersionsByMatch].map(([matchId, hybrid]) => [
      matchId,
      hybrid.topScorelines.slice(0, 3)
    ])
  );
  const nightlyRefresh = readNightlyRefreshState();
  const expectedTargetDate = expectedNightlyTargetDate();
  const shouldAutoRefresh = false;
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

      <AutoRefreshOnOpen enabled={shouldAutoRefresh} targetDate={expectedTargetDate} />

      <KnockoutTree fixtures={data.fixtures} overrides={overrides} odds={odds} teamInputs={teamInputs} iteration={modelIteration} />

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

      <ModelIterationPanel state={modelIteration} />

      {recentPendingResults.length ? (
        <section className="panel postmatch-panel" style={{ marginBottom: 16 }}>
          <div className="section-title-row">
            <div>
              <p className="muted">赛果同步失败，正在重试。</p>
              <h2>等待赛果更新</h2>
              <p className="muted">这些比赛已经开赛或结束，后台同步任务尚未取得最终比分；取得赛果后会自动进入复盘。</p>
            </div>
            <span className="pill warning">{recentPendingResults.length} 场待更新</span>
          </div>
          <div className="compact-list">
            {recentPendingResults.map((prediction) => (
              <div key={prediction.match.id} className="compact-item">
                <div>
                  <strong>{teamName(prediction.match.home)} 对 {teamName(prediction.match.away)}</strong>
                  <p className="muted">
                    {beijingMatchTime(prediction.match.sortDate)} · 赛果同步中，稍后自动重试
                    <ScorelineChips scores={hybridTopScoresByMatch[prediction.match.id]} label="Hybrid V2 前三比分" />
                  </p>
                </div>
                <div className="compact-right">
                  <span>赛前方向</span>
                  <strong>{outcomeLabel(favoriteSide(prediction), prediction)} {pct(prediction.blended[favoriteSide(prediction)])}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {completedPredictions.length ? (
        <section className="panel postmatch-panel" style={{ marginBottom: 16 }}>
          <div className="section-title-row">
            <div>
              <h2>已结束比赛赛果与赛后复盘</h2>
              <p className="muted">运行刷新后会先自动更新已结束赛果；这里记录预测和实际差别，后续用来修正模型。</p>
            </div>
            <span className="pill ok">自动复盘</span>
          </div>
          <Link href="/review" className="pill ok">查看完整复盘</Link>
          <div className="compact-list">
            {recentCompletedPredictions.map((prediction) => (
              <PostMatchReview key={prediction.match.id} prediction={prediction} override={overrideMap.get(prediction.match.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <BankrollPlan
        seeds={stakeSeeds}
        strategyStats={strategyStats}
        refreshState={nightlyRefresh}
        hybridTopScoresByMatch={hybridTopScoresByMatch}
      />

      <section className="grid-2">
        {simulation ? <div className="panel">
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
        </div> : null}

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
                    <span className="pill">{fixtureStageName(prediction.match.stage, prediction.match.group)}</span>
                  </div>
                  <div className="match-meta">
                    {beijingMatchTime(prediction.match.sortDate)} · {venueName(prediction.match.venue)}
                    <ScorelineChips scores={hybridTopScoresByMatch[prediction.match.id]} label="Hybrid V2 前三比分" />
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
                {matchReason(prediction, hybridVersionsByMatch.get(prediction.match.id))}
                <ModelComparisonBlock
                  versions={modelVersionsByMatch.get(prediction.match.id) ?? []}
                />
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

function ModelComparisonBlock({ versions }: { versions: ModelVariantPrediction[] }) {
  return (
    <div className="model-comparison-grid">
      {versions.map((version) => (
        <section key={version.version} className="model-comparison-card">
          <header>
            <strong>{modelVersionLabel(version.version)}</strong>
            <span>90分钟胜/平/负</span>
          </header>
          <div className="model-outcomes" aria-label={`${modelVersionLabel(version.version)} 90分钟胜平负概率`}>
            <span><b>主胜</b>{pct(version.probabilities90.home)}</span>
            <span><b>平局</b>{pct(version.probabilities90.draw)}</span>
            <span><b>客胜</b>{pct(version.probabilities90.away)}</span>
          </div>
          <small>
            <b>xG</b> {numberOrDash(version.lambdaHome)} : {numberOrDash(version.lambdaAway)} <i>前三比分</i>{" "}
            {version.topScorelines.slice(0, 3).map((row) => `${row.score} ${pct(row.probability)}`).join(" / ") || "\u7f3a\u5c11\u6570\u636e"}
          </small>
          <small>
            <b>{"\u603b\u8fdb\u7403"}</b> {numberOrDash(totalGoals(version))} <i>{"\u5927"}2.5</i> {pctOrDash(version.probabilityOver25)} <i>BTTS</i> {pctOrDash(version.probabilityBttsYes)}
          </small>
          <small>
            <b>{"\u664b\u7ea7"}</b> {pctOrDash(version.probabilityHomeAdvance)} / {pctOrDash(version.probabilityAwayAdvance)} <i>{"\u4fe1\u5fc3"}</i> {pct(version.confidence)}
          </small>
          <small>
            <b>{"\u6570\u636e\u5b8c\u6574\u5ea6"}</b> {marketQualityLabel(version.marketDataQuality)} <i>{missingInputsText(version.missingMarketInputs)}</i>
          </small>
          <small>
            <b>{"\u4fee\u6b63"}</b> {lambdaText("\u5e02\u573a", version.componentLambdas.marketHome, version.componentLambdas.marketAway)} /{" "}
            {version.version === "market-only-v1" ? "\u7403\u961f\u6309\u6a21\u578b\u5b9a\u4e49\u4e0d\u4f7f\u7528" : lambdaText("\u7403\u961f", version.componentLambdas.teamHome, version.componentLambdas.teamAway)} /{" "}
            {lambdaText("\u6700\u7ec8", version.componentLambdas.finalHome, version.componentLambdas.finalAway)}; {contextText(version)}
          </small>
        </section>
      ))}
    </div>
  );
}

function contextText(version: ModelVariantPrediction): string {
  if (version.version !== "hybrid-v2-knockout") return "\u9635\u5bb9/\u4f24\u505c/\u5929\u6c14/\u573a\u5730\uff1a\u6a21\u578b\u5b9a\u4e49\u4e0d\u4f7f\u7528";
  const labels: Record<string, string> = { confirmed_lineup: "\u9635\u5bb9", injury_feed: "\u4f24\u505c", weather: "\u5929\u6c14", venue: "\u573a\u5730" };
  const missing = version.missingContextInputs.map((key) => labels[key] ?? key);
  const used = Object.keys(labels).filter((key) => !version.missingContextInputs.includes(key)).map((key) => labels[key]);
  return `${used.length ? `${used.join("/")}\u5df2\u7eb3\u5165` : "\u9635\u5bb9/\u4f24\u505c/\u5929\u6c14/\u573a\u5730\uff1a\u672a\u7eb3\u5165"}${missing.length && used.length ? `\uff1b\u7f3a${missing.join("/")}` : ""}`;
}

function modelVersionLabel(version: string): string {
  if (version === "market-only-v1") return "市场模型";
  if (version === "hybrid-v2-knockout") return "Hybrid V2";
  return "Baseline V1";
}

function numberOrDash(value: number | null): string {
  return value == null ? "--" : value.toFixed(2);
}

function pctOrDash(value: number | null): string {
  return value == null ? "--" : pct(value);
}


function totalGoals(version: ModelVariantPrediction): number | null {
  return version.lambdaHome == null || version.lambdaAway == null ? null : version.lambdaHome + version.lambdaAway;
}

function lambdaText(label: string, home: number | null, away: number | null): string {
  return `${label}${home == null || away == null ? "\u672a\u7eb3\u5165" : `${home.toFixed(2)}:${away.toFixed(2)}`}`;
}

function marketQualityLabel(quality: ModelVariantPrediction["marketDataQuality"]): string {
  if (quality === "full") return "\u5b8c\u6574";
  if (quality === "partial") return "\u90e8\u5206\u76d8";
  if (quality === "h2h_only") return "\u4ec5\u80dc\u5e73\u8d1f";
  return "\u7f3a\u5931";
}

function missingInputsText(inputs: string[]): string {
  return inputs.length ? `\u7f3a ${inputs.join("/")}` : "\u65e0\u7f3a\u53e3";
}

function NightlyRefreshPanel({ state }: { state: NightlyRefreshState }) {
  const ok = state.status === "ok";
  return (
    <section className="panel nightly-panel" style={{ marginBottom: 16 }}>
      <div className="section-title-row">
        <div>
          <h2>21:00 赛前核对</h2>
          <p className="muted">每天晚上 9 点自动刷新近期未开赛赔率，并更新首发/伤停核对提醒。首发自动抓取暂未接入时，会明确标记为需要人工复核。</p>
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
          <strong>{state.targetDate ?? "近期"}</strong>
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

function ModelIterationPanel({ state }: { state: ModelIterationState }) {
  const active = state.sampleSize >= 6;
  return (
    <section className="panel model-iteration-panel" style={{ marginBottom: 16 }}>
      <div className="section-title-row">
        <div>
          <h2>模型自我迭代</h2>
          <p className="muted">每天赛果刷新后，系统会用已完赛样本复盘预测偏差，并小幅修正后续比赛的概率。</p>
        </div>
        <span className={active ? "pill ok" : "pill warning"}>{active ? "已参与预测" : "记录中"}</span>
      </div>
      <div className="nightly-grid">
        <div>
          <span>已学习场次</span>
          <strong>{state.sampleSize} 场</strong>
        </div>
        <div>
          <span>首选命中率</span>
          <strong>{state.sampleSize ? pct(state.accuracy) : "暂无"}</strong>
        </div>
        <div>
          <span>平局漏判</span>
          <strong>{state.drawMisses} 场</strong>
        </div>
        <div>
          <span>高信心错判</span>
          <strong>{state.overconfidentWrong} 场</strong>
        </div>
        <div>
          <span>布赖尔</span>
          <strong>{state.sampleSize ? state.brier.toFixed(3) : "暂无"}</strong>
        </div>
      </div>
      <div className="iteration-adjustments">
        <span>温度 {state.adjustments.modelTemperature.toFixed(3)}</span>
        <span>平局保护 +{pct(state.adjustments.drawBoost)}</span>
        <span>热门降温 {pct(state.adjustments.favoriteShrink)}</span>
        <span>盘口权重 {state.adjustments.marketWeightShift >= 0 ? "+" : ""}{pct(state.adjustments.marketWeightShift)}</span>
      </div>
      <div className="compact-list">
        {state.notes.map((note) => (
          <div key={note} className="compact-item">
            <span>{note}</span>
          </div>
        ))}
      </div>
      <p className="note">更新时间：{dateTime(state.updatedAt)}。样本少于 6 场时只记录复盘，不自动改权重。</p>
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
          {fixtureStageName(prediction.match.stage, prediction.match.group)} · {beijingMatchTime(prediction.match.sortDate)} · 推荐 {favorite}
          <ScorelineChips homeXg={prediction.xgHome} awayXg={prediction.xgAway} preferred={scorelinePreferredSide(prediction)} />
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
        <ScorelineChips homeXg={prediction.xgHome} awayXg={prediction.xgAway} preferred={scorelinePreferredSide(prediction)} />
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

function isNearBeijing(prediction: MatchPrediction): boolean {
  const today = beijingDateKey(new Date().toISOString());
  const tomorrow = beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  const matchDay = beijingDateKey(prediction.match.sortDate);
  return matchDay === today || matchDay === tomorrow;
}

function hasNotStarted(prediction: MatchPrediction): boolean {
  return new Date(prediction.match.sortDate).getTime() > Date.now();
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

function scorelinePreferredSide(prediction: MatchPrediction): "home" | "draw" | "away" | undefined {
  return prediction.match.stage === "group" ? favoriteSide(prediction) : undefined;
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
  if (actualSide === "draw") return "提高平局保护权重；在 1X2 差距不大时，单场胜平负优先降级为观望或只保留平局风险提示，并同步下调热门方比分概率。";
  return "加入临场盘口漂移和阵容核对后再给最终买入；盘口与模型不一致时降低推荐等级。";
}
