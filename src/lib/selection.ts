import { beijingMatchTime, pct } from "@/lib/format";
import { isOddsFreshForBuying, oddsAgeHours, oddsFreshnessText } from "@/lib/freshness";
import { teamName } from "@/lib/i18n";
import { matchTiming, type MatchTimingStatus } from "@/lib/match-timing";
import { marketProbabilities } from "@/lib/model";
import { MIN_BUY_PROBABILITY_GAP } from "@/lib/risk";
import type { MatchPrediction, OddsQuote, OutcomeKey } from "@/lib/types";

export type MarketDriftStatus = "顺向" | "中性" | "反向" | "缺少对比";
export type MarketTrendStatus = "持续压向" | "临场回撤" | "持续反向" | "横盘" | "样本不足";
export type MarketConsensusStatus = "多源一致" | "单一来源" | "分歧偏大" | "缺少当前价格";
export type SmartMoneyStatus = "强 commitment" | "小注跟随" | "观察不买" | "避开";
export type PatternFitStatus = "pattern支持" | "谨慎降级" | "pattern反对";

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
  marketTrendMomentum: number | null;
  marketTrendStatus: MarketTrendStatus;
  marketTrendText: string;
  marketConsensusProviders: number;
  marketConsensusSpread: number | null;
  marketConsensusStatus: MarketConsensusStatus;
  marketConsensusText: string;
  matchInBuyingWindow: boolean;
  matchTimingStatus: MatchTimingStatus;
  matchTimingText: string;
  hoursUntilKickoff: number | null;
  smartMoneyScore: number;
  smartMoneyStatus: SmartMoneyStatus;
  smartMoneyText: string;
  patternFitScore: number;
  patternFitStatus: PatternFitStatus;
  patternFitText: string;
  stakeAdvice: string;
  reason: string;
}

export interface StakeSeed {
  id: string;
  matchId: string;
  stage: MatchPrediction["match"]["stage"];
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
  marketKind: "sportsbook" | "prediction_market" | "smart_wallet" | null;
  oddsAgeHours: number | null;
  oddsFreshForBuying: boolean;
  oddsFreshnessText: string;
  marketDrift: number | null;
  marketDriftStatus: MarketDriftStatus;
  marketDriftText: string;
  marketTrendMomentum: number | null;
  marketTrendStatus: MarketTrendStatus;
  marketTrendText: string;
  marketConsensusProviders: number;
  marketConsensusSpread: number | null;
  marketConsensusStatus: MarketConsensusStatus;
  marketConsensusText: string;
  matchInBuyingWindow: boolean;
  matchTimingStatus: MatchTimingStatus;
  matchTimingText: string;
  hoursUntilKickoff: number | null;
  smartMoneyScore: number;
  smartMoneyStatus: SmartMoneyStatus;
  smartMoneyText: string;
  patternFitScore: number;
  patternFitStatus: PatternFitStatus;
  patternFitText: string;
  stakeAdvice: string;
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
    stage: candidate.prediction.match.stage,
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
      ? `${candidate.prediction.odds.provider}${marketKindText(candidate.prediction.odds.marketKind)}`
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
    marketTrendMomentum: candidate.marketTrendMomentum,
    marketTrendStatus: candidate.marketTrendStatus,
    marketTrendText: candidate.marketTrendText,
    marketConsensusProviders: candidate.marketConsensusProviders,
    marketConsensusSpread: candidate.marketConsensusSpread,
    marketConsensusStatus: candidate.marketConsensusStatus,
    marketConsensusText: candidate.marketConsensusText,
    matchInBuyingWindow: candidate.matchInBuyingWindow,
    matchTimingStatus: candidate.matchTimingStatus,
    matchTimingText: candidate.matchTimingText,
    hoursUntilKickoff: candidate.hoursUntilKickoff,
    smartMoneyScore: candidate.smartMoneyScore,
    smartMoneyStatus: candidate.smartMoneyStatus,
    smartMoneyText: candidate.smartMoneyText,
    patternFitScore: candidate.patternFitScore,
    patternFitStatus: candidate.patternFitStatus,
    patternFitText: candidate.patternFitText,
    stakeAdvice: candidate.stakeAdvice
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
  const marketTrend = marketTrendForSide(side, oddsHistory);
  const marketConsensus = marketConsensusForSide(side, oddsHistory);
  const timing = matchTiming(prediction.match);
  const favoriteBlankRisk = blankRiskForSide(prediction, side);
  const topScoreSupport = topScoreSupportForSide(prediction, side);
  const smartMoney = smartMoneySignal({
    side,
    probability,
    edge,
    hasMarket: marketProbability != null,
    modelMarketAgree,
    marketDriftStatus: marketDrift.status,
    marketTrendStatus: marketTrend.status,
    marketConsensusStatus: marketConsensus.status,
    marketConsensusProviders: marketConsensus.providers,
    marketConsensusSpread: marketConsensus.spread,
    oddsFreshForBuying: isOddsFreshForBuying(prediction.odds),
    matchInBuyingWindow: timing.inBuyingWindow,
    dataQualityScore: prediction.dataQualityScore
  });
  const patternFit = patternFitSignal({
    side,
    probability,
    drawProbability: prediction.blended.draw,
    favoriteBlankRisk,
    topScoreSupport,
    iteration: prediction.modelIteration
  });
  const stakeAdvice = finalStakeAdvice(smartMoney.status, patternFit.status);
  const certaintyScore =
    probability * 100 +
    prediction.confidenceScore * 45 +
    prediction.dataQualityScore * 0.22 +
    (modelSide === side ? 5 : 0) +
    (modelMarketAgree ? 10 : 0) +
    (hardDataPassed ? 8 : -12) +
    (marketDrift.status === "顺向" ? 6 : marketDrift.status === "反向" ? -14 : 0) +
    (marketTrend.status === "持续压向" ? 8 : marketTrend.status === "临场回撤" ? -12 : marketTrend.status === "持续反向" ? -16 : 0) +
    (marketConsensus.status === "多源一致" ? 8 : marketConsensus.status === "分歧偏大" ? -16 : marketConsensus.status === "单一来源" ? -6 : -10) +
    (timing.inBuyingWindow ? 6 : timing.status === "等待临场" ? -8 : -20) +
    (side === "draw" ? -12 : 0) +
    (edge == null ? -8 : Math.max(-8, Math.min(12, edge * 120))) +
    (smartMoney.score - 50) * 0.35 +
    (patternFit.score - 50) * 0.28;
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
    marketTrendMomentum: marketTrend.momentum,
    marketTrendStatus: marketTrend.status,
    marketTrendText: marketTrend.text,
    marketConsensusProviders: marketConsensus.providers,
    marketConsensusSpread: marketConsensus.spread,
    marketConsensusStatus: marketConsensus.status,
    marketConsensusText: marketConsensus.text,
    matchInBuyingWindow: timing.inBuyingWindow,
    matchTimingStatus: timing.status,
    matchTimingText: timing.text,
    hoursUntilKickoff: timing.hoursUntilKickoff,
    smartMoneyScore: smartMoney.score,
    smartMoneyStatus: smartMoney.status,
    smartMoneyText: smartMoney.text,
    patternFitScore: patternFit.score,
    patternFitStatus: patternFit.status,
    patternFitText: patternFit.text,
    stakeAdvice,
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
    ? `${input.prediction.odds.provider}${marketKindText(input.prediction.odds.marketKind)}`
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
  const openingByProvider = new Map<string, OddsQuote>();
  for (const quote of oddsHistory.filter((row) => row.quoteType === "opening")) {
    const current = openingByProvider.get(quote.provider);
    if (!current || quote.fetchedAt.localeCompare(current.fetchedAt) < 0) openingByProvider.set(quote.provider, quote);
  }

  const latestByProvider = new Map<string, OddsQuote>();
  for (const quote of oddsHistory.filter((row) => row.quoteType !== "opening")) {
    const current = latestByProvider.get(quote.provider);
    if (!current || quote.fetchedAt.localeCompare(current.fetchedAt) > 0) latestByProvider.set(quote.provider, quote);
  }

  const deltas: number[] = [];
  for (const [provider, latest] of latestByProvider.entries()) {
    const opening = openingByProvider.get(provider);
    if (!opening) continue;
    const openingProb = marketProbabilities(opening)?.[side];
    const latestProb = marketProbabilities(latest)?.[side];
    if (openingProb == null || latestProb == null) continue;
    deltas.push(latestProb - openingProb);
  }

  if (!deltas.length) {
    return { delta: null, status: "缺少对比", text: "缺少同源 baseline/当前盘口对比" };
  }

  const delta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const sourceText = `${deltas.length} 个来源`;
  if (delta >= 0.025) return { delta, status: "顺向", text: `${sourceText}同源盘口顺向移动 ${pct(delta)}` };
  if (delta <= -0.025) return { delta, status: "反向", text: `${sourceText}同源盘口反向移动 ${pct(Math.abs(delta))}` };
  return { delta, status: "中性", text: `${sourceText}同源盘口变化 ${pct(delta)}` };
}

function marketTrendForSide(side: OutcomeKey, oddsHistory: OddsQuote[]): { momentum: number | null; status: MarketTrendStatus; text: string } {
  const openingByProvider = new Map<string, OddsQuote>();
  for (const quote of oddsHistory.filter((row) => row.quoteType === "opening")) {
    const current = openingByProvider.get(quote.provider);
    if (!current || quote.fetchedAt.localeCompare(current.fetchedAt) < 0) openingByProvider.set(quote.provider, quote);
  }

  const currentByProvider = new Map<string, OddsQuote[]>();
  for (const quote of oddsHistory.filter((row) => row.quoteType !== "opening")) {
    const rows = currentByProvider.get(quote.provider) ?? [];
    rows.push(quote);
    currentByProvider.set(quote.provider, rows);
  }

  const baselineDeltas: number[] = [];
  const momentumDeltas: number[] = [];
  for (const [provider, rows] of currentByProvider.entries()) {
    const ordered = [...rows].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    const latest = ordered.at(-1);
    if (!latest) continue;
    const previous = [...ordered].reverse().find((quote) => quote.fetchedAt !== latest.fetchedAt);
    const baseline = openingByProvider.get(provider) ?? ordered[0];
    if (!previous || !baseline) continue;

    const baselineProb = marketProbabilities(baseline)?.[side];
    const previousProb = marketProbabilities(previous)?.[side];
    const latestProb = marketProbabilities(latest)?.[side];
    if (baselineProb == null || previousProb == null || latestProb == null) continue;
    baselineDeltas.push(latestProb - baselineProb);
    momentumDeltas.push(latestProb - previousProb);
  }

  if (momentumDeltas.length < 3) {
    return { momentum: null, status: "样本不足", text: "同源时间点不足，暂不能判断持续压向或回撤" };
  }

  const baselineMove = average(baselineDeltas);
  const momentum = average(momentumDeltas);
  const sourceText = `${momentumDeltas.length} 个来源`;
  const text = `${sourceText}，baseline ${signedPct(baselineMove)}，最近一跳 ${signedPct(momentum)}`;
  if (baselineMove >= 0.025 && momentum >= -0.003) return { momentum, status: "持续压向", text };
  if (baselineMove >= 0.025 && momentum <= -0.008) return { momentum, status: "临场回撤", text };
  if (baselineMove <= -0.025 && momentum <= 0.003) return { momentum, status: "持续反向", text };
  if (Math.abs(momentum) <= 0.006) return { momentum, status: "横盘", text };
  return momentum > 0 ? { momentum, status: "持续压向", text } : { momentum, status: "临场回撤", text };
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

function smartMoneySignal(input: {
  side: OutcomeKey;
  probability: number;
  edge: number | null;
  hasMarket: boolean;
  modelMarketAgree: boolean;
  marketDriftStatus: MarketDriftStatus;
  marketTrendStatus: MarketTrendStatus;
  marketConsensusStatus: MarketConsensusStatus;
  marketConsensusProviders: number;
  marketConsensusSpread: number | null;
  oddsFreshForBuying: boolean;
  matchInBuyingWindow: boolean;
  dataQualityScore: number;
}): { score: number; status: SmartMoneyStatus; text: string; stakeAdvice: string } {
  let score = 50;
  const signals: string[] = [];
  const warnings: string[] = [];

  if (!input.hasMarket) {
    score -= 32;
    warnings.push("缺少当前市场价格，不能判断聪明钱");
  }

  if (input.side === "draw") {
    score -= 18;
    warnings.push("平局方向波动大，当前只作观察");
  }

  if (input.modelMarketAgree) {
    score += 14;
    signals.push("模型与市场同向");
  } else {
    score -= 12;
    warnings.push("模型与市场分歧");
  }

  if (input.marketDriftStatus === "顺向") {
    score += 18;
    signals.push("盘口向首选方向移动");
  } else if (input.marketDriftStatus === "反向") {
    score -= 24;
    warnings.push("盘口反向移动");
  } else if (input.marketDriftStatus === "中性") {
    score += 5;
    signals.push("盘口没有明显反向");
  } else {
    score -= 8;
    warnings.push("缺少 baseline 到当前的同源移动对比");
  }

  if (input.marketTrendStatus === "持续压向") {
    score += 10;
    signals.push("最近一跳仍在压向首选");
  } else if (input.marketTrendStatus === "临场回撤") {
    score -= 14;
    warnings.push("最近一跳出现回撤");
  } else if (input.marketTrendStatus === "持续反向") {
    score -= 18;
    warnings.push("最近一跳继续反向");
  } else if (input.marketTrendStatus === "横盘") {
    score += 2;
    signals.push("最近一跳横盘");
  } else {
    score -= 4;
    warnings.push("时间点不足，暂不能判断持续 commitment");
  }

  if (input.marketConsensusStatus === "多源一致") {
    score += input.marketConsensusProviders >= 5 ? 18 : 13;
    signals.push(`${input.marketConsensusProviders} 个来源一致`);
  } else if (input.marketConsensusStatus === "单一来源") {
    score -= 8;
    warnings.push("只有单一盘口来源");
  } else if (input.marketConsensusStatus === "分歧偏大") {
    score -= 22;
    warnings.push(`多家分歧偏大${input.marketConsensusSpread == null ? "" : `，差异 ${pct(input.marketConsensusSpread)}`}`);
  } else {
    score -= 12;
    warnings.push("缺少当前盘口来源");
  }

  if (input.edge != null && input.edge >= 0.03) {
    score += 14;
    signals.push(`模型比市场高 ${pct(input.edge)}`);
  } else if (input.edge != null && input.edge < -0.03) {
    score -= 16;
    warnings.push(`市场价格偏贵 ${pct(Math.abs(input.edge))}`);
  }

  if (input.probability >= 0.62) {
    score += 10;
    signals.push("首选概率过 62%");
  } else if (input.probability < 0.55) {
    score -= 12;
    warnings.push("首选概率低于 55%");
  }

  if (input.oddsFreshForBuying) score += 6;
  else {
    score -= 10;
    warnings.push("盘口不够新");
  }

  if (input.matchInBuyingWindow) score += 6;
  else {
    score -= 8;
    warnings.push("不在赛前 72 小时窗口");
  }

  if (input.dataQualityScore >= 80) score += 5;
  else warnings.push(`数据质量 ${input.dataQualityScore}/100`);

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const status: SmartMoneyStatus =
    bounded >= 76 && input.side !== "draw"
      ? "强 commitment"
      : bounded >= 62 && input.side !== "draw"
        ? "小注跟随"
        : bounded >= 45
          ? "观察不买"
          : "避开";
  const stakeAdvice =
    status === "强 commitment"
      ? "主选"
      : status === "小注跟随"
        ? "备选"
        : status === "观察不买"
          ? "观察"
          : "放弃";
  const text = `${signals.length ? signals.join("；") : "暂无正向聪明钱信号"}。${warnings.length ? `风险：${warnings.join("；")}。` : "未见硬性反向信号。"}`;
  return { score: bounded, status, text, stakeAdvice };
}

function patternFitSignal(input: {
  side: OutcomeKey;
  probability: number;
  drawProbability: number;
  favoriteBlankRisk: number;
  topScoreSupport: number;
  iteration: MatchPrediction["modelIteration"];
}): { score: number; status: PatternFitStatus; text: string } {
  let score = 66;
  const signals: string[] = [];
  const warnings: string[] = [];

  if (!input.iteration.applied || input.iteration.sampleSize < 6) {
    score -= 8;
    warnings.push("本届已完赛样本不足，pattern 只作参考");
  } else {
    signals.push(`已学习本届 ${input.iteration.sampleSize} 场`);
  }

  if (input.side === "draw") {
    score -= 22;
    warnings.push("当前策略不主动买平局");
  }

  if (input.iteration.drawBoost >= 0.08 && input.side !== "draw") {
    if (input.drawProbability >= 0.28) {
      score -= 24;
      warnings.push(`本届平局漏判偏多，且本场平局概率 ${pct(input.drawProbability)}`);
    } else if (input.drawProbability >= 0.23) {
      score -= 13;
      warnings.push(`本届平局保护已拉满，本场仍有 ${pct(input.drawProbability)} 平局风险`);
    } else {
      score += 5;
      signals.push("本场平局风险低于当前保护阈值");
    }
  }

  if (input.iteration.favoriteShrink >= 0.05) {
    if (input.probability < 0.58) {
      score -= 20;
      warnings.push("本届热门过热明显，首选概率未过 58%");
    } else if (input.probability < 0.64) {
      score -= 10;
      warnings.push("热门降温生效，首选未达到强信心区");
    } else {
      score += 8;
      signals.push("首选概率高于本届热门降温后的安全线");
    }
  }

  if (input.iteration.modelTemperature >= 1.15 && input.probability < 0.62) {
    score -= 9;
    warnings.push("模型温度升高后仍不够集中");
  }

  if (input.favoriteBlankRisk >= 0.18) {
    score -= 16;
    warnings.push(`热门零进球风险 ${pct(input.favoriteBlankRisk)} 偏高`);
  } else if (input.favoriteBlankRisk >= 0.12) {
    score -= 8;
    warnings.push(`热门零进球风险 ${pct(input.favoriteBlankRisk)} 需要防低比分`);
  } else {
    score += 5;
    signals.push("热门零进球风险低");
  }

  if (input.topScoreSupport >= 2) {
    score += 12;
    signals.push("前三比分有多个支持首选方向");
  } else if (input.topScoreSupport === 1) {
    score += 4;
    signals.push("前三比分有一个支持首选方向");
  } else {
    score -= 18;
    warnings.push("前三比分不支持首选方向");
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const status: PatternFitStatus = bounded >= 70 ? "pattern支持" : bounded >= 48 ? "谨慎降级" : "pattern反对";
  const text = `${signals.length ? signals.join("；") : "暂无正向 pattern"}。${warnings.length ? `风险：${warnings.join("；")}。` : "未见本届 pattern 硬性反对。"}`;
  return { score: bounded, status, text };
}

function finalStakeAdvice(smartMoneyStatus: SmartMoneyStatus, patternStatus: PatternFitStatus): string {
  if (patternStatus === "pattern反对") {
    return smartMoneyStatus === "强 commitment" ? "备选" : "放弃";
  }
  if (patternStatus === "谨慎降级") {
    if (smartMoneyStatus === "强 commitment") return "备选";
    if (smartMoneyStatus === "小注跟随") return "观察";
    return smartMoneyStatus === "避开" ? "放弃" : "观察";
  }
  if (smartMoneyStatus === "强 commitment") return "主选";
  if (smartMoneyStatus === "小注跟随") return "备选";
  if (smartMoneyStatus === "观察不买") return "观察";
  return "放弃";
}

function marketKindText(kind: NonNullable<StakeSeed["marketKind"]>): string {
  if (kind === "prediction_market") return "预测市场";
  if (kind === "smart_wallet") return "聪明钱包";
  return "盘口";
}

function blankRiskForSide(prediction: MatchPrediction, side: OutcomeKey): number {
  if (side === "home") return poisson(prediction.xgHome, 0);
  if (side === "away") return poisson(prediction.xgAway, 0);
  return Math.max(poisson(prediction.xgHome, 0), poisson(prediction.xgAway, 0));
}

function topScoreSupportForSide(prediction: MatchPrediction, side: OutcomeKey): number {
  return topScorelines(prediction.xgHome, prediction.xgAway, 3, side).filter((row) => {
    const [home, away] = row.score.split("-").map((value) => Number(value));
    if (side === "home") return home > away;
    if (side === "away") return away > home;
    return home === away;
  }).length;
}

function topScorelines(homeXg: number, awayXg: number, limit: number, preferred?: OutcomeKey): Array<{ score: string; probability: number }> {
  const rows: Array<{ score: string; probability: number }> = [];
  for (let home = 0; home <= 5; home += 1) {
    for (let away = 0; away <= 5; away += 1) {
      const probability = scorelineProbability(homeXg, awayXg, home, away);
      rows.push({ score: `${home}-${away}`, probability });
    }
  }
  const ranked = rows.sort((a, b) => b.probability - a.probability);
  if (!preferred) return ranked.slice(0, limit);
  const matching = ranked.filter((row) => scoreOutcome(row.score) === preferred);
  const rest = ranked.filter((row) => scoreOutcome(row.score) !== preferred);
  return [...matching, ...rest].slice(0, limit);
}

function scoreOutcome(score: string): OutcomeKey {
  const [home, away] = score.split("-").map(Number);
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function scorelineProbability(homeXg: number, awayXg: number, home: number, away: number): number {
  return poisson(homeXg, home) * poisson(awayXg, away) * scorelineAdjustment(homeXg, awayXg, home, away);
}

function scorelineAdjustment(homeXg: number, awayXg: number, home: number, away: number): number {
  const minXg = Math.min(homeXg, awayXg);
  const totalXg = homeXg + awayXg;
  let factor = 1;
  if ((home === 0 && away === 0) || (home === 1 && away === 1)) factor *= 1.06;
  if (minXg >= 0.55 && home > 0 && away > 0) factor *= 1.08;
  if (minXg >= 0.75 && home > 0 && away > 0) factor *= 1.05;
  if (away === 0 && home >= 2 && awayXg >= 0.55) factor *= 0.78;
  if (home === 0 && away >= 2 && homeXg >= 0.55) factor *= 0.78;
  if (away === 0 && home === 1 && awayXg >= 0.85) factor *= 0.9;
  if (home === 0 && away === 1 && homeXg >= 0.85) factor *= 0.9;
  if (totalXg >= 2.7 && home + away >= 4 && home > 0 && away > 0) factor *= 1.06;
  return factor;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${pct(value)}`;
}

function poisson(lambda: number, goals: number): number {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}
