import type { BacktestResult } from "@/lib/types";

export const MIN_CONSERVATIVE_EXPECTED_ROI = 0.02;
export const DEFAULT_MAX_PORTFOLIO_EXPOSURE = 0.03;
export const MIN_BUY_PROBABILITY_GAP = 0.1;

export interface StrategyStat {
  threshold: string;
  matches: number;
  accuracy: number;
  lowerBound: number;
  breakEvenPrice: number | null;
  conservativeBreakEvenPrice: number | null;
}

export interface BuyingStrategyAudit {
  label: string;
  threshold: string;
  matches: number;
  correct: number;
  wrong: number;
  accuracy: number;
  lowerBound: number;
  minPriceWithMargin: number | null;
  historicalRoiAtMinPrice: number | null;
  conservativeRoiAtMinPrice: number | null;
  sampleWarning: string;
}

export function minPriceWithSafetyMargin(conservativeProbability: number): number {
  if (conservativeProbability <= 0) return Infinity;
  return (1 + MIN_CONSERVATIVE_EXPECTED_ROI) / conservativeProbability;
}

type MatchesKey = "highConfidence55Matches" | "highConfidence60Matches";
type AccuracyKey = "highConfidence55Accuracy" | "highConfidence60Accuracy";

export function strategyStatFromBacktests(backtests: BacktestResult[], threshold: string, matchesKey: MatchesKey, accuracyKey: AccuracyKey): StrategyStat {
  let matches = 0;
  let correct = 0;
  for (const row of backtests) {
    const rowMatches = row[matchesKey] ?? 0;
    const rowAccuracy = row[accuracyKey];
    if (!rowMatches || rowAccuracy == null) continue;
    matches += rowMatches;
    correct += rowMatches * rowAccuracy;
  }
  const accuracy = matches ? correct / matches : 0;
  const lowerBound = matches ? wilsonLowerBound(accuracy, matches) : 0;
  return {
    threshold,
    matches,
    accuracy,
    lowerBound,
    breakEvenPrice: accuracy > 0 ? 1 / accuracy : null,
    conservativeBreakEvenPrice: lowerBound > 0 ? 1 / lowerBound : null
  };
}

export function historicalCapForProbability(probability: number, strategyStats: StrategyStat[]): number {
  const strict = strategyStats.find((stat) => stat.threshold.startsWith("60"));
  const standard = strategyStats.find((stat) => stat.threshold.startsWith("55"));
  if (probability >= 0.6 && strict?.matches) return strict.lowerBound;
  if (probability >= 0.55 && standard?.matches) return standard.lowerBound;
  return probability;
}

export function bestHistoricalStat(strategyStats: StrategyStat[]): StrategyStat | null {
  const available = strategyStats.filter((stat) => stat.matches > 0);
  if (!available.length) return null;
  return [...available].sort((a, b) => b.lowerBound - a.lowerBound || b.matches - a.matches)[0];
}

export function buyingStrategyAuditsFromBacktests(backtests: BacktestResult[]): BuyingStrategyAudit[] {
  return [
    auditFromStat("55%+ 高信心买入池", strategyStatFromBacktests(backtests, "55%+", "highConfidence55Matches", "highConfidence55Accuracy")),
    auditFromStat("60%+ 严格精选买入池", strategyStatFromBacktests(backtests, "60%+", "highConfidence60Matches", "highConfidence60Accuracy"))
  ];
}

function auditFromStat(label: string, stat: StrategyStat): BuyingStrategyAudit {
  const correct = Math.round(stat.matches * stat.accuracy);
  const wrong = Math.max(0, stat.matches - correct);
  const minPrice = stat.lowerBound > 0 ? minPriceWithSafetyMargin(stat.lowerBound) : null;
  return {
    label,
    threshold: stat.threshold,
    matches: stat.matches,
    correct,
    wrong,
    accuracy: stat.accuracy,
    lowerBound: stat.lowerBound,
    minPriceWithMargin: minPrice,
    historicalRoiAtMinPrice: minPrice == null ? null : stat.accuracy * minPrice - 1,
    conservativeRoiAtMinPrice: minPrice == null ? null : stat.lowerBound * minPrice - 1,
    sampleWarning: stat.matches < 50 ? "样本偏少，必须结合盘口和临场数据" : "样本可用，但仍不能保证未来盈利"
  };
}

function wilsonLowerBound(accuracy: number, matches: number): number {
  if (!matches) return 0;
  const z = 1.28155; // 80% one-sided lower confidence bound.
  const denominator = 1 + (z * z) / matches;
  const center = accuracy + (z * z) / (2 * matches);
  const margin = z * Math.sqrt((accuracy * (1 - accuracy)) / matches + (z * z) / (4 * matches * matches));
  return Math.max(0, (center - margin) / denominator);
}
