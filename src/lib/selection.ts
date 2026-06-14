import { beijingMatchTime, pct } from "@/lib/format";
import { isOddsFreshForBuying, oddsAgeHours, oddsFreshnessText } from "@/lib/freshness";
import { teamName } from "@/lib/i18n";
import { matchTiming, type MatchTimingStatus } from "@/lib/match-timing";
import { marketProbabilities } from "@/lib/model";
import { MIN_BUY_PROBABILITY_GAP } from "@/lib/risk";
import type { MatchPrediction, OddsQuote, OutcomeKey } from "@/lib/types";

export type MarketDriftStatus = "顺向" | "中性" | "反向" | "缺少对比";
export type MarketConsensusStatus = "多源一致" | "单一来源" | "分歧偏大" | "缺少当前价格";

export interface BuyingCandidate {
  prediction: MatchPrediction;
  side: OutcomeKey;
  label: string;
  probability: number;
  modelProbability: number;
  marketProbability: number | null;
  impliedPrice: number | null;
  edge: number | null;
  probabilityGap: number;
  modelMarketAgree: boolean;
  modelFavoriteSide: OutcomeKey;
  marketFavoriteSide: OutcomeKey | null;
  certaintyScore: number;
  grade: "重点观察" | "小注观察" | "仅模型观察" | "暂不买入";
  dataQualityScore: number;
  dataWarnings: string[];
  teamDataFreshness: MatchPrediction["teamDataFreshness"];
  oddsAgeHours: number | null;
  oddsFreshForBuying: boolean;
  oddsFreshnessText: string;
  marketDrift: number | null;
  marketDriftStatus: MarketDriftStatus;
  marketDriftText: string;
  marketConsensusProviders: number;
  marketConsensusSpread: number | null;
  marketConsensusStatus: MarketConsensusStatus;
  marketConsensusText: string;
  matchInBuyingWindow: boolean;
  matchTimingStatus: MatchTimingStatus;
  matchTimingText: string;
  hoursUntilKickoff: number | null;
  reason: string;
}

export interface StakeSeed {
  id: string;
  matchId: string;
  side: OutcomeKey;
  matchLabel: string;
  homeTeam: string;
  awayTeam: string;
  exposureTeams: string[];
  sideLabel: string;
  homeTeamLabel: string;
  awayTeamLabel: string;
  xgHome: number;
  xgAway: number;
  likelyScore: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  marketHomeProbability: number | null;
  marketDrawProbability: number | null;
  marketAwayProbability: number | null;
  homePrice: number | null;
  drawPrice: number | null;
  awayPrice: number | null;
  probability: number;
  modelProbability: number;
  marketProbability: number | null;
  impliedPrice: number | null;
  edge: number | null;
  probabilityGap: number;
  modelMarketAgree: boolean;
  modelFavoriteSide: OutcomeKey;
  marketFavoriteSide: OutcomeKey | null;
  grade: BuyingCandidate["grade"];
  dateLabel: string;
  source: string;
  dataQualityScore: number;
  dataWarnings: string[];
  manualDataCoverage: MatchPrediction["manualDataCoverage"];
  teamDataFreshness: MatchPrediction["teamDataFreshness"];
  lineupCheckFreshness: MatchPrediction["lineupCheckFreshness"];
  quoteType: "opening" | "current" | "closing" | null;
  marketKind: "sportsbook" | "prediction_market" | null;
  oddsAgeHours: number | null;
  oddsFreshForBuying: boolean;
  oddsFreshnessText: string;
  marketDrift: number | null;
  marketDriftStatus: MarketDriftStatus;
  marketDriftText: string;
  marketConsensusProviders: number;
  marketConsensusSpread: number | null;
  marketConsensusStatus: MarketConsensusStatus;
  marketConsensusText: string;
  matchInBuyingWindow: boolean;
  matchTimingStatus: MatchTimingStatus;
  matchTimingText: string;
  hoursUntilKickoff: number | null;
}

export function topBuyingCandidates(predictions: MatchPrediction[], limit = 8, oddsHistory: OddsQuote[] = []): BuyingCandidate[] {
  const historyByMatch = groupOddsByMatch(oddsHistory);
  return predictions
    .map((prediction) => candidateFromPrediction(prediction, historyByMatch.get(prediction.match.id) ?? []))
    .sort((a, b) => b.certaintyScore - a.certaintyScore)
    .slice(0, limit);
}

export function stakeSeedsFromCandidates(candidates: BuyingCandidate[]): StakeSeed[] {
  return candidates.map((candidate) => ({
    id: `${candidate.prediction.match.id}-${candidate.side}`,
    matchId: candidate.prediction.match.id,
    side: candidate.side,
    matchLabel: `${teamName(candidate.prediction.match.home)} 对 ${teamName(candidate.prediction.match.away)}`,
    homeTeam: candidate.prediction.match.home,
    awayTeam: candidate.prediction.match.away,
    exposureTeams: exposureTeamsForCandidate(candidate),
    sideLabel: candidate.label,
    homeTeamLabel: teamName(candidate.prediction.match.home),
    awayTeamLabel: teamName(candidate.prediction.match.away),
    xgHome: candidate.prediction.xgHome,
    xgAway: candidate.prediction.xgAway,
    likelyScore: candidate.prediction.likelyScore,
    homeProbability: candidate.prediction.blended.home,
    drawProbability: candidate.prediction.blended.draw,
    awayProbability: candidate.prediction.blended.away,
    marketHomeProbability: candidate.prediction.market?.home ?? null,
    marketDrawProbability: candidate.prediction.market?.draw ?? null,
    marketAwayProbability: candidate.prediction.market?.away ?? null,
    homePrice: candidate.prediction.odds?.homePrice ?? null,
    drawPrice: candidate.prediction.odds?.drawPrice ?? null,
    awayPrice: candidate.prediction.odds?.awayPrice ?? null,
    probability: candidate.probability,
    modelProbability: candidate.modelProbability,
    marketProbability: candidate.marketProbability,
    impliedPrice: candidate.impliedPrice,
    edge: candidate.edge,
    probabilityGap: candidate.probabilityGap,
    modelMarketAgree: candidate.modelMarketAgree,
    modelFavoriteSide: candidate.modelFavoriteSide,
    marketFavoriteSide: candidate.marketFavoriteSide,
    grade: candidate.grade,
    dateLabel: beijingMatchTime(candidate.prediction.match.sortDate),
    source: candidate.prediction.odds
      ? `${candidate.prediction.odds.provider}${candidate.prediction.odds.marketKind === "prediction_market" ? "预测市场" : "盘口"}`
      : "无盘口",
    dataQualityScore: candidate.dataQualityScore,
    dataWarnings: candidate.dataWarnings,
    manualDataCoverage: candidate.prediction.manualDataCoverage,
    teamDataFreshness: candidate.teamDataFreshness,
    lineupCheckFreshness: candidate.prediction.lineupCheckFreshness,
    quoteType: candidate.prediction.odds?.quoteType ?? null,
    marketKind: candidate.prediction.odds?.marketKind ?? null,
    oddsAgeHours: candidate.oddsAgeHours,
    oddsFreshForBuying: candidate.oddsFreshForBuying,
    oddsFreshnessText: candidate.oddsFreshnessText,
    marketDrift: candidate.marketDrift,
    marketDriftStatus: candidate.marketDriftStatus,
    marketDriftText: candidate.marketDriftText,
    marketConsensusProviders: candidate.marketConsensusProviders,
    marketConsensusSpread: candidate.marketConsensusSpread,
    marketConsensusStatus: candidate.marketConsensusStatus,
    marketConsensusText: candidate.marketConsensusText,
    matchInBuyingWindow: candidate.matchInBuyingWindow,
    matchTimingStatus: candidate.matchTimingStatus,
    matchTimingText: candidate.matchTimingText,
    hoursUntilKickoff: candidate.hoursUntilKickoff
  }));
}

function exposureTeamsForCandidate(candidate: BuyingCandidate): string[] {
  if (candidate.side === "draw") return [candidate.prediction.match.home, candidate.prediction.match.away];
  if (candidate.side === "home") return [candidate.prediction.match.home];
  return [candidate.prediction.match.away];
}

export function candidateFromPrediction(prediction: MatchPrediction, oddsHistory: OddsQuote[] = []): BuyingCandidate {
  const side = favoriteSide(prediction.blended);
  const probability = prediction.blended[side];
  const modelProbability = prediction.model[side];
  const marketProbability = prediction.market?.[side] ?? null;
  const impliedPrice = impliedPriceForSide(prediction, side);
  const edge = marketProbability == null ? null : modelProbability - marketProbability;
  const probabilityGap = prediction.confidenceScore;
  const modelSide = favoriteSide(prediction.model);
  const marketSide = prediction.market ? favoriteSide(prediction.market) : null;
  const modelMarketAgree = marketSide == null ? false : modelSide === marketSide && modelSide === side;
  const hardDataPassed = passesHardDataGate(prediction);
  const marketDrift = marketDriftForSide(side, oddsHistory);
  const marketConsensus = marketConsensusForSide(side, oddsHistory);
  const timing = matchTiming(prediction.match);
  const certaintyScore =
    probability * 100 +
    prediction.confidenceScore * 45 +
    prediction.dataQualityScore * 0.22 +
    (modelSide === side ? 5 : 0) +
    (modelMarketAgree ? 10 : 0) +
    (hardDataPassed ? 8 : -12) +
    (marketDrift.status === "顺向" ? 6 : marketDrift.status === "反向" ? -14 : 0) +
    (marketConsensus.status === "多源一致" ? 8 : marketConsensus.status === "分歧偏大" ? -16 : marketConsensus.status === "单一来源" ? -6 : -10) +
    (timing.inBuyingWindow ? 6 : timing.status === "等待临场" ? -8 : -20) +
    (side === "draw" ? -12 : 0) +
    (edge == null ? -8 : Math.max(-8, Math.min(12, edge * 120)));
  const grade = gradeCandidate({
    probability,
    gap: prediction.confidenceScore,
    hasMarket: marketProbability != null,
    edge,
    modelMarketAgree,
    hardDataPassed,
    dataQualityScore: prediction.dataQualityScore,
    marketConsensusStatus: marketConsensus.status,
    matchInBuyingWindow: timing.inBuyingWindow,
    side
  });

  return {
    prediction,
    side,
    label: sideLabel(prediction, side),
    probability,
    modelProbability,
    marketProbability,
    impliedPrice,
    edge,
    probabilityGap,
    modelMarketAgree,
    modelFavoriteSide: modelSide,
    marketFavoriteSide: marketSide,
    certaintyScore,
    grade,
    dataQualityScore: prediction.dataQualityScore,
    dataWarnings: prediction.dataWarnings,
    teamDataFreshness: prediction.teamDataFreshness,
    oddsAgeHours: oddsAgeHours(prediction.odds),
    oddsFreshForBuying: isOddsFreshForBuying(prediction.odds),
    oddsFreshnessText: oddsFreshnessText(prediction.odds),
    marketDrift: marketDrift.delta,
    marketDriftStatus: marketDrift.status,
    marketDriftText: marketDrift.text,
    marketConsensusProviders: marketConsensus.providers,
    marketConsensusSpread: marketConsensus.spread,
    marketConsensusStatus: marketConsensus.status,
    marketConsensusText: marketConsensus.text,
    matchInBuyingWindow: timing.inBuyingWindow,
    matchTimingStatus: timing.status,
    matchTimingText: timing.text,
    hoursUntilKickoff: timing.hoursUntilKickoff,
    reason: candidateReason({ prediction, probability, edge, modelMarketAgree, hasMarket: marketProbability != null })
  };
}

export function sideLabel(prediction: MatchPrediction, side: OutcomeKey): string {
  if (side === "home") return `${teamName(prediction.match.home)}胜`;
  if (side === "away") return `${teamName(prediction.match.away)}胜`;
  return "平局";
}

export function favoriteSide(probs: Record<OutcomeKey, number>): OutcomeKey {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function impliedPriceForSide(prediction: MatchPrediction, side: OutcomeKey): number | null {
  if (!prediction.odds) return null;
  if (side === "home") return prediction.odds.homePrice;
  if (side === "away") return prediction.odds.awayPrice;
  return prediction.odds.drawPrice;
}

function gradeCandidate(input: {
  probability: number;
  gap: number;
  hasMarket: boolean;
  edge: number | null;
  modelMarketAgree: boolean;
  hardDataPassed: boolean;
  dataQualityScore: number;
  marketConsensusStatus: MarketConsensusStatus;
  matchInBuyingWindow: boolean;
  side: OutcomeKey;
}): BuyingCandidate["grade"] {
  if (!input.hasMarket) {
    return input.probability >= 0.58 && input.gap >= 0.12 ? "仅模型观察" : "暂不买入";
  }
  if (input.side === "draw") return "暂不买入";
  if (!input.matchInBuyingWindow) return "暂不买入";
  if (input.gap < MIN_BUY_PROBABILITY_GAP) return "暂不买入";
  if (input.marketConsensusStatus === "分歧偏大") return "暂不买入";
  if (input.edge != null && input.edge < -0.04) return "暂不买入";
  if (!input.hardDataPassed) {
    return input.dataQualityScore >= 60 && input.edge != null && input.edge >= 0.03 && input.probability >= 0.55 ? "小注观察" : "暂不买入";
  }
  if (
    input.probability >= 0.58 &&
    input.gap >= 0.12 &&
    input.modelMarketAgree &&
    input.marketConsensusStatus === "多源一致" &&
    input.edge != null &&
    input.edge >= 0.03
  ) {
    return "重点观察";
  }
  if (input.probability >= 0.52 && input.gap >= 0.08 && (input.edge == null || input.edge >= 0)) return "小注观察";
  return "暂不买入";
}

function candidateReason(input: {
  prediction: MatchPrediction;
  probability: number;
  edge: number | null;
  modelMarketAgree: boolean;
  hasMarket: boolean;
}): string {
  const source = input.prediction.odds
    ? `${input.prediction.odds.provider}${input.prediction.odds.marketKind === "prediction_market" ? "预测市场" : "盘口"}`
    : "无盘口";
  const edgeText =
    input.edge == null
      ? "暂无价格优势判断"
      : input.edge >= 0.03
        ? `模型比市场高 ${pct(input.edge)}，存在价格优势`
        : input.edge <= -0.03
          ? `模型比市场低 ${pct(Math.abs(input.edge))}，价格偏贵`
           : "模型与市场基本接近";
  const agreeText = input.modelMarketAgree ? "模型和市场方向一致" : input.hasMarket ? "模型和市场方向不完全一致" : "只有模型方向";
  const dataText = input.prediction.dataWarnings.length
    ? `数据质量 ${input.prediction.dataQualityScore}/100，${input.prediction.dataWarnings.join("；")}`
    : `数据质量 ${input.prediction.dataQualityScore}/100，达到当前门槛`;
  const consensusText = input.prediction.market
    ? `${input.prediction.marketMeta.sourceLabel}，动态市场权重 ${pct(input.prediction.marketMeta.marketWeight)}，共识 ${input.prediction.marketMeta.consensusStatus}`
    : "暂无盘口共识";
  return `${agreeText}，融合概率 ${pct(input.probability)}，来源：${source}；${consensusText}；${edgeText}。${dataText}。${oddsFreshnessText(input.prediction.odds)}。`;
}

function passesHardDataGate(prediction: MatchPrediction): boolean {
  return (
    prediction.dataQualityScore >= 80 &&
    prediction.manualDataCoverage === "both" &&
    prediction.teamDataFreshness === "fresh" &&
    isOddsFreshForBuying(prediction.odds)
  );
}

function groupOddsByMatch(odds: OddsQuote[]): Map<string, OddsQuote[]> {
  const grouped = new Map<string, OddsQuote[]>();
  for (const quote of odds) {
    const rows = grouped.get(quote.matchId) ?? [];
    rows.push(quote);
    grouped.set(quote.matchId, rows);
  }
  return grouped;
}

function marketDriftForSide(side: OutcomeKey, oddsHistory: OddsQuote[]): { delta: number | null; status: MarketDriftStatus; text: string } {
  const opening = [...oddsHistory]
    .filter((quote) => quote.quoteType === "opening")
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))[0];
  const latest = [...oddsHistory]
    .filter((quote) => quote.quoteType !== "opening")
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  if (!opening || !latest) {
    return { delta: null, status: "缺少对比", text: "缺少开盘/当前对比" };
  }
  const openingProb = marketProbabilities(opening)?.[side];
  const latestProb = marketProbabilities(latest)?.[side];
  if (openingProb == null || latestProb == null) {
    return { delta: null, status: "缺少对比", text: "盘口对比无效" };
  }
  const delta = latestProb - openingProb;
  if (delta >= 0.025) return { delta, status: "顺向", text: `市场顺向移动 ${pct(delta)}` };
  if (delta <= -0.025) return { delta, status: "反向", text: `市场反向移动 ${pct(Math.abs(delta))}` };
  return { delta, status: "中性", text: `盘口变化 ${pct(delta)}` };
}

function marketConsensusForSide(side: OutcomeKey, oddsHistory: OddsQuote[]): {
  providers: number;
  spread: number | null;
  status: MarketConsensusStatus;
  text: string;
} {
  const latestByProvider = new Map<string, OddsQuote>();
  for (const quote of oddsHistory.filter((row) => row.quoteType !== "opening")) {
    const current = latestByProvider.get(quote.provider);
    if (!current || quote.fetchedAt.localeCompare(current.fetchedAt) > 0) latestByProvider.set(quote.provider, quote);
  }
  const probabilities = [...latestByProvider.values()]
    .map((quote) => marketProbabilities(quote)?.[side])
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!probabilities.length) {
    return { providers: 0, spread: null, status: "缺少当前价格", text: "缺少当前/临场盘口来源" };
  }
  if (probabilities.length === 1) {
    return { providers: 1, spread: null, status: "单一来源", text: "只有 1 个当前盘口来源，需补充第二来源确认" };
  }
  const spread = Math.max(...probabilities) - Math.min(...probabilities);
  if (spread <= 0.05) {
    return { providers: probabilities.length, spread, status: "多源一致", text: `${probabilities.length} 个来源基本一致，差异 ${pct(spread)}` };
  }
  return { providers: probabilities.length, spread, status: "分歧偏大", text: `${probabilities.length} 个来源分歧偏大，差异 ${pct(spread)}` };
}
