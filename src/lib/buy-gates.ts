import {
  historicalCapForProbability,
  minPriceWithSafetyMargin,
  MIN_BUY_PROBABILITY_GAP,
  MIN_CONSERVATIVE_EXPECTED_ROI,
  type StrategyStat
} from "@/lib/risk";
import type { BuyingCandidate } from "@/lib/selection";

export interface BuyGateCandidate extends BuyingCandidate {
  conservativeProbability: number;
  minAcceptablePrice: number;
  conservativeExpectedRoi: number;
  buyGatePassed: boolean;
  buyGateBlockers: string[];
}

type BuyGateBaseCandidate = Omit<BuyGateCandidate, "buyGatePassed" | "buyGateBlockers">;

export function buyGateCandidates(candidates: BuyingCandidate[], strategyStats: StrategyStat[]): BuyGateCandidate[] {
  return candidates
    .map((candidate) => {
      const conservativeProbability = Math.min(candidate.modelProbability, historicalCapForProbability(candidate.probability, strategyStats));
      const minAcceptablePrice = minPriceWithSafetyMargin(conservativeProbability);
      const conservativeExpectedRoi = candidate.impliedPrice == null ? Number.NEGATIVE_INFINITY : conservativeProbability * candidate.impliedPrice - 1;
      const enriched = { ...candidate, conservativeProbability, minAcceptablePrice, conservativeExpectedRoi };
      const buyGateBlockers = buyGateBlockersForCandidate(enriched);
      return { ...enriched, buyGateBlockers, buyGatePassed: buyGateBlockers.length === 0 };
    })
    .sort((a, b) => Number(b.buyGatePassed) - Number(a.buyGatePassed) || b.certaintyScore - a.certaintyScore);
}

export function buyGateBlockersForCandidate(candidate: BuyGateBaseCandidate): string[] {
  const blockers: string[] = [];
  const odds = candidate.prediction.odds;
  if (candidate.probability < 0.55) blockers.push("融合概率低于 55%");
  if (candidate.dataQualityScore < 80) blockers.push("数据质量低于 80 分");
  if (candidate.prediction.manualDataCoverage !== "both") blockers.push("两队补充数据不完整");
  if (candidate.teamDataFreshness !== "fresh") blockers.push("球队数据不是 14 天内更新");
  if (!candidate.matchInBuyingWindow) blockers.push("不在开赛前 72 小时临场窗口");
  if (candidate.side === "draw") blockers.push("平局方向暂不买入");
  if (candidate.probabilityGap < MIN_BUY_PROBABILITY_GAP) blockers.push("胜负优势差不足 10%");
  if (!candidate.modelMarketAgree) blockers.push("模型和市场方向不一致");
  if (!odds) blockers.push("缺少盘口/预测市场价格");
  if (!candidate.oddsFreshForBuying) blockers.push("盘口超过 48 小时或只有旧价格");
  if (candidate.marketDriftStatus === "反向") blockers.push("盘口出现反向移动");
  if (candidate.marketConsensusStatus !== "多源一致") blockers.push("盘口来源未达到多源一致");
  if (candidate.edge == null || candidate.edge < 0.03) blockers.push("模型相对市场优势不足 3%");
  if (candidate.impliedPrice == null) blockers.push("缺少可买赔率");
  else if (candidate.impliedPrice < candidate.minAcceptablePrice) blockers.push("赔率低于保守安全线");
  if (candidate.conservativeExpectedRoi < MIN_CONSERVATIVE_EXPECTED_ROI) blockers.push("保守期望收益低于 2%");
  return blockers;
}
