import type { StakeSeed } from "@/lib/selection";
import type { OutcomeKey } from "@/lib/types";

export type TradeAction = "主选" | "备选" | "观察" | "放弃";

export interface ScoreLine {
  score: string;
  probability: number;
}

export interface TradePlan {
  label: string;
  action: TradeAction;
  confidence: number;
  className: string;
  note: string;
}

export function topScorelines(homeXg: number, awayXg: number, limit: number, preferred?: OutcomeKey): ScoreLine[] {
  const rows: ScoreLine[] = [];
  for (let home = 0; home <= 5; home += 1) {
    for (let away = 0; away <= 5; away += 1) {
      rows.push({ score: `${home}-${away}`, probability: scorelineProbability(homeXg, awayXg, home, away) });
    }
  }
  const ranked = rows.sort((a, b) => b.probability - a.probability);
  if (!preferred) return ranked.slice(0, limit);
  const matching = ranked.filter((row) => outcomeOfScore(row.score) === preferred);
  const rest = ranked.filter((row) => outcomeOfScore(row.score) !== preferred);
  return [...matching, ...rest].slice(0, limit);
}

function outcomeOfScore(score: string): OutcomeKey {
  const [home, away] = score.split("-").map(Number);
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

export function bttsTradePlan(seed: StakeSeed): TradePlan {
  const probability = bttsProbability(seed);
  const noProbability = 1 - probability;
  const chooseYes = probability >= noProbability;
  const confidence = Math.max(probability, noProbability);
  const action = actionFromThresholds(confidence, 0.62, 0.56, 0.51);
  return {
    label: chooseYes ? "是" : "否",
    action,
    confidence,
    className: tradeActionClass(action),
    note: action === "观察" ? "刚过五成，优势不足以列主选" : chooseYes ? "两队都有进球路径" : "至少一队零进球风险高"
  };
}

export function oneXTwoTradePlan(seed: StakeSeed): TradePlan {
  const action = tradeActionFromAdvice(seed.stakeAdvice);
  return {
    label: seed.sideLabel,
    action,
    confidence: seed.probability,
    className: tradeActionClass(action),
    note: `${seed.smartMoneyStatus} / ${seed.patternFitStatus}`
  };
}

export function goalsTradePlan(seed: StakeSeed): TradePlan {
  const ranges = [
    { label: "0-2球", min: 0, max: 2 },
    { label: "2-3球", min: 2, max: 3 },
    { label: "2-4球", min: 2, max: 4 },
    { label: "3-5球", min: 3, max: 5 }
  ].map((range) => ({ ...range, probability: totalGoalsRangeProbability(seed.xgHome, seed.xgAway, range.min, range.max) }));
  const best = ranges.sort((a, b) => b.probability - a.probability)[0];
  const action = actionFromThresholds(best.probability, 0.64, 0.58, 0.54);
  return {
    label: best.label,
    action,
    confidence: best.probability,
    className: tradeActionClass(action),
    note: `总 xG ${(seed.xgHome + seed.xgAway).toFixed(2)}`
  };
}

export function tradeActionFromAdvice(advice: string): TradeAction {
  if (advice === "主选" || advice.includes("可买")) return "主选";
  if (advice === "备选" || advice.includes("最多") || advice.includes("小注")) return "备选";
  if (advice === "观察" || advice.includes("观察") || advice.includes("临场")) return "观察";
  return "放弃";
}

export function tradeActionClass(action: TradeAction): string {
  if (action === "主选") return "edge-positive";
  if (action === "放弃") return "edge-negative";
  return "edge-neutral";
}

function actionFromThresholds(confidence: number, main: number, backup: number, observe: number): TradeAction {
  if (confidence >= main) return "主选";
  if (confidence >= backup) return "备选";
  if (confidence >= observe) return "观察";
  return "放弃";
}

function bttsProbability(seed: StakeSeed): number {
  const noHome = poisson(seed.xgHome, 0);
  const noAway = poisson(seed.xgAway, 0);
  const raw = (1 - noHome) * (1 - noAway);
  const minXg = Math.min(seed.xgHome, seed.xgAway);
  const lift = minXg >= 0.75 ? 0.035 : minXg >= 0.55 ? 0.02 : -0.015;
  return clamp(raw + lift, 0, 1);
}

function totalGoalsRangeProbability(homeXg: number, awayXg: number, min: number, max: number): number {
  let probability = 0;
  let total = 0;
  for (let home = 0; home <= 7; home += 1) {
    for (let away = 0; away <= 7; away += 1) {
      const p = scorelineProbability(homeXg, awayXg, home, away);
      total += p;
      const goals = home + away;
      if (goals >= min && goals <= max) probability += p;
    }
  }
  return total ? probability / total : 0;
}

function scorelineProbability(homeXg: number, awayXg: number, home: number, away: number): number {
  return poisson(homeXg, home) * poisson(awayXg, away) * scorelineAdjustment(homeXg, awayXg, home, away);
}

function scorelineAdjustment(homeXg: number, awayXg: number, home: number, away: number): number {
  const minXg = Math.min(homeXg, awayXg);
  const totalXg = homeXg + awayXg;
  let factor = 1;
  if ((home === 0 && away === 0) || (home === 1 && away === 1)) factor *= 1.06;
  if (minXg >= 0.5 && home > 0 && away > 0) factor *= 1.1;
  if (minXg >= 0.72 && home > 0 && away > 0) factor *= 1.07;
  if (away === 0 && home >= 2 && awayXg >= 0.5) factor *= 0.72;
  if (home === 0 && away >= 2 && homeXg >= 0.5) factor *= 0.72;
  if (away === 0 && home === 1 && awayXg >= 0.85) factor *= 0.9;
  if (home === 0 && away === 1 && homeXg >= 0.85) factor *= 0.9;
  if (totalXg >= 2.7 && home + away >= 4 && home > 0 && away > 0) factor *= 1.06;
  return factor;
}

function poisson(lambda: number, goals: number): number {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
