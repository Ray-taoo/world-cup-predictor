import { MatchOverrideForm } from "@/components/MatchOverrideForm";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { buyGateCandidates, type BuyGateCandidate } from "@/lib/buy-gates";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { beijingMatchTime, number, pct } from "@/lib/format";
import { groupName, teamName, venueName } from "@/lib/i18n";
import { predictionForMatch } from "@/lib/model";
import { matchReason } from "@/lib/reasons";
import { topBuyingCandidates, type BuyingCandidate } from "@/lib/selection";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import { strategyStatFromBacktests } from "@/lib/risk";
import type { MatchPrediction, OverrideResult } from "@/lib/types";

export default async function MatchesPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const predictions = data.fixtures
    .map((match) => predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs))
    .sort(comparePredictionTime);
  const upcomingPredictions = predictions.filter((prediction) => !overrideMap.has(prediction.match.id));
  const strategyStats = [
    strategyStatFromBacktests(data.backtests, "55%+", "highConfidence55Matches", "highConfidence55Accuracy"),
    strategyStatFromBacktests(data.backtests, "60%+", "highConfidence60Matches", "highConfidence60Accuracy")
  ];
  const buyingCandidates = buyGateCandidates(topBuyingCandidates(upcomingPredictions, 10, odds), strategyStats).sort(compareCandidateTime);
  const highConfidence = [...upcomingPredictions]
    .filter((prediction) => maxProbability(prediction) >= 0.55 || prediction.recommendationLevel.includes("强推荐"))
    .sort((a, b) => a.match.sortDate.localeCompare(b.match.sortDate) || maxProbability(b) - maxProbability(a))
    .slice(0, 12);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>比赛预测与手动赛果</h1>
          <p>小组赛输出主胜/平/客胜概率。开赛后可直接锁定比分，系统会重算积分榜和晋级概率。</p>
        </div>
        <span className={odds.length ? "pill ok" : "pill warning"}>{odds.length ? "盘口已融合" : "未接入实时盘口"}</span>
      </section>

      <section className="match-list">
        <section className="panel">
          <h2>高信心预测筛选</h2>
          <p className="muted">只列出最高概率达到 55% 左右或推荐等级较高的比赛，用来优先观察确定性更强的场次。</p>
          <div className="compact-list">
            {(highConfidence.length ? highConfidence : upcomingPredictions.slice(0, 8)).map((prediction) => (
              <div key={prediction.match.id} className="compact-item">
                <div>
                  <strong>
                    {teamName(prediction.match.home)} 对 {teamName(prediction.match.away)}
                  </strong>
                  <p className="muted">
                    {groupName(prediction.match.group)} · {beijingMatchTime(prediction.match.sortDate)} · {favoriteLabel(prediction)} · 预计比分 {prediction.likelyScore} · {prediction.odds ? `已用 ${prediction.odds.provider}` : "未接入盘口"}
                  </p>
                </div>
                <div className="compact-right">
                  <span className={prediction.recommendationLevel.includes("强推荐") ? "pill ok" : "pill"}>{prediction.recommendationLevel}</span>
                  <strong>{pct(maxProbability(prediction))}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel buy-board">
          <div className="section-title-row">
            <div>
              <h2>买入观察候选</h2>
              <p className="muted">优先列出方向更明确、概率差更大、且市场价格没有明显偏贵的结果。没有盘口时只作为模型观察。</p>
            </div>
            <span className={odds.length ? "pill ok" : "pill warning"}>{odds.length ? "可看价格优势" : "仅模型排序"}</span>
          </div>
          <div className="signal-grid">
            {buyingCandidates.map((candidate) => (
              <BuyingCandidateCard key={`${candidate.prediction.match.id}-${candidate.side}`} candidate={candidate} />
            ))}
          </div>
        </section>

        {data.groups.map((group) => (
          <section key={group.id} className="panel">
            <h2>{groupName(group.id)}比赛预测</h2>
            <div className="match-list">
              {predictions
                .filter((prediction) => prediction.match.group === group.id)
                .map((prediction) => {
                  const override = overrideMap.get(prediction.match.id);
                  return (
                    <article key={prediction.match.id} className="match-card">
                      <div className="match-top">
                        <div>
                          <div className="match-title">
                            <span>第 {prediction.match.matchNumber} 场</span>
                            <span>{teamName(prediction.match.home)}</span>
                            <span className="muted">对</span>
                            <span>{teamName(prediction.match.away)}</span>
                            <span className="pill">{groupName(prediction.match.group)}</span>
                            <span className={prediction.recommendationLevel.includes("强推荐") ? "pill ok" : "pill"}>{prediction.recommendationLevel}</span>
                            {override ? <span className="pill ok">{resultSourceLabel(override)} {override.homeScore}:{override.awayScore}</span> : null}
                          </div>
                          <div className="match-meta">
                            {beijingMatchTime(prediction.match.sortDate)} · {venueName(prediction.match.venue)} · 预计比分 {prediction.likelyScore} · 预计进球{" "}
                            {number(prediction.xgHome)}:{number(prediction.xgAway)}
                          </div>
                        </div>
                        <MatchOverrideForm matchId={prediction.match.id} currentHome={override?.homeScore} currentAway={override?.awayScore} />
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
                      <div className="match-meta">
                        <strong>概率拆分：</strong>
                        自有模型 {pct(prediction.model.home)}/{pct(prediction.model.draw)}/{pct(prediction.model.away)}
                        {prediction.market
                          ? `；盘口去水 ${pct(prediction.market.home)}/${pct(prediction.market.draw)}/${pct(prediction.market.away)}`
                          : "；暂无实时盘口。"}
                      </div>
                      <div className="match-meta">
                        <strong>赔率与优势：</strong>
                        {oddsAndEdgeText(prediction)}
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </section>
    </>
  );
}

function BuyingCandidateCard({ candidate }: { candidate: BuyGateCandidate }) {
  const { prediction } = candidate;
  const blockers = candidate.buyGateBlockers.slice(0, 4);
  return (
    <article className="signal-card">
      <div className="signal-head">
        <div>
          <strong>
            {teamName(prediction.match.home)} 对 {teamName(prediction.match.away)}
          </strong>
          <p className="muted">
            {groupName(prediction.match.group)} · {beijingMatchTime(prediction.match.sortDate)} · {candidate.label} · {prediction.odds ? prediction.odds.provider : "未接入盘口"}
          </p>
        </div>
        <span className={candidate.grade === "重点观察" ? "pill ok" : candidate.grade === "暂不买入" ? "pill warning" : "pill"}>
          {candidate.grade}
        </span>
      </div>
      <div className="signal-metrics">
        <div>
          <span>融合概率</span>
          <strong>{pct(candidate.probability)}</strong>
        </div>
        <div>
          <span>市场概率</span>
          <strong>{candidate.marketProbability == null ? "暂无" : pct(candidate.marketProbability)}</strong>
        </div>
        <div>
          <span>赔率优势</span>
          <strong>{candidate.edge == null ? "暂无" : pct(candidate.edge)}</strong>
        </div>
        <div>
          <span>数据质量</span>
          <strong>{candidate.dataQualityScore}/100</strong>
        </div>
        <div>
          <span>胜负优势差</span>
          <strong>{pct(candidate.probabilityGap)}</strong>
        </div>
        <div>
          <span>球队数据</span>
          <strong>{teamFreshnessLabel(candidate.teamDataFreshness)}</strong>
        </div>
        <div>
          <span>临场核对</span>
          <strong>{lineupCheckLabel(candidate.prediction.lineupCheckFreshness)}</strong>
        </div>
        <div>
          <span>临场窗口</span>
          <strong>{candidate.matchTimingStatus}</strong>
        </div>
        <div>
          <span>方向风险</span>
          <strong>{candidate.side === "draw" ? "平局禁买" : "胜负方向"}</strong>
        </div>
        <div>
          <span>盘口漂移</span>
          <strong>{candidate.marketDriftStatus}</strong>
        </div>
        <div>
          <span>盘口一致性</span>
          <strong>{candidate.marketConsensusStatus}</strong>
        </div>
        <div>
          <span>模型市场</span>
          <strong>{candidate.modelMarketAgree ? "一致" : "分歧"}</strong>
        </div>
        <div>
          <span>精选准入</span>
          <strong>{candidate.buyGatePassed ? "通过" : "未通过"}</strong>
        </div>
      </div>
      <p className="signal-reason">
        {candidate.reason} {candidate.marketConsensusText}。{candidate.matchTimingText}。
      </p>
      <p className="signal-reason">
        {candidate.buyGatePassed
          ? "已通过精选买入硬门槛：模型市场方向一致、盘口多源一致、赔率高于保守安全线。"
          : `未进精选：${blockers.length ? blockers.join("；") : "保守规则未给出买入信号"}。`}
      </p>
    </article>
  );
}

function maxProbability(prediction: MatchPrediction): number {
  return Math.max(prediction.blended.home, prediction.blended.draw, prediction.blended.away);
}

function comparePredictionTime(a: MatchPrediction, b: MatchPrediction): number {
  return a.match.sortDate.localeCompare(b.match.sortDate) || a.match.matchNumber - b.match.matchNumber;
}

function compareCandidateTime(a: BuyingCandidate, b: BuyingCandidate): number {
  return a.prediction.match.sortDate.localeCompare(b.prediction.match.sortDate) || a.prediction.match.matchNumber - b.prediction.match.matchNumber;
}

function resultSourceLabel(override: OverrideResult): string {
  return override.note?.startsWith("自动抓取赛果") ? "已自动更新赛果" : "已手动锁定";
}

function favoriteLabel(prediction: MatchPrediction): string {
  const { blended, match } = prediction;
  if (blended.home >= blended.draw && blended.home >= blended.away) return `${teamName(match.home)}胜`;
  if (blended.away >= blended.draw) return `${teamName(match.away)}胜`;
  return "平局";
}

function oddsAndEdgeText(prediction: MatchPrediction): string {
  if (!prediction.odds || !prediction.market) {
    return "未接入免费赔率或手工盘口，当前只能看模型概率，不能判断价格是否划算。";
  }
  const side = favoriteSide(prediction);
  const modelProbability = prediction.model[side];
  const marketProbability = prediction.market[side];
  const edge = modelProbability - marketProbability;
  const price = side === "home" ? prediction.odds.homePrice : side === "away" ? prediction.odds.awayPrice : prediction.odds.drawPrice;
  const marketKind = prediction.odds.marketKind === "prediction_market" ? "预测市场" : "博彩公司盘口";
  const edgeText = edge >= 0.03 ? "模型给得更高，有价格优势" : edge <= -0.03 ? "市场价格偏贵，先谨慎" : "模型和市场接近";
  return `${marketKind}代表来源 ${prediction.odds.provider}，赔率 ${number(price, 2)}；内部使用 ${prediction.marketMeta.sourceLabel}，市场权重 ${pct(prediction.marketMeta.marketWeight)}，共识状态 ${prediction.marketMeta.consensusStatus}；市场概率 ${pct(marketProbability)}，模型概率 ${pct(modelProbability)}，优势 ${pct(edge)}，${edgeText}。`;
}

function favoriteSide(prediction: MatchPrediction): "home" | "draw" | "away" {
  const { blended } = prediction;
  if (blended.home >= blended.draw && blended.home >= blended.away) return "home";
  if (blended.away >= blended.draw) return "away";
  return "draw";
}

function teamFreshnessLabel(value: BuyingCandidate["teamDataFreshness"]): string {
  if (value === "fresh") return "14 天内";
  if (value === "partial") return "部分过期";
  if (value === "stale") return "已过期";
  return "缺失";
}

function lineupCheckLabel(value: MatchPrediction["lineupCheckFreshness"]): string {
  if (value === "fresh") return "已核对";
  if (value === "partial") return "部分核对";
  if (value === "stale") return "待更新";
  return "后续补充";
}
