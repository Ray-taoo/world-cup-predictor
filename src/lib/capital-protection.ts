export interface CapitalProtectionGuard {
  paused: boolean;
  reasons: string[];
  maxAllowedLoss: number;
  currentLoss: number;
  remainingLossBudget: number;
  effectivePortfolioFraction: number;
}

export function effectivePortfolioFraction(maxPortfolioFraction: number, dailyDrawdownFraction: number, maxDailyDrawdownFraction: number): number {
  const remainingDailyLossFraction = Math.max(0, maxDailyDrawdownFraction - dailyDrawdownFraction);
  return Math.min(maxPortfolioFraction, remainingDailyLossFraction);
}

export function capitalProtectionGuard(
  bankroll: number,
  dailyDrawdownFraction: number,
  lossStreak: number,
  maxDailyDrawdownFraction: number,
  effectivePortfolioFractionValue: number
): CapitalProtectionGuard {
  const reasons: string[] = [];
  const maxAllowedLoss = Math.max(0, bankroll * maxDailyDrawdownFraction);
  const currentLoss = Math.max(0, bankroll * dailyDrawdownFraction);
  const remainingLossBudget = Math.max(0, maxAllowedLoss - currentLoss);
  if (bankroll <= 0) reasons.push("本金必须大于 0");
  if (dailyDrawdownFraction >= maxDailyDrawdownFraction) reasons.push("今日已亏损达到当日止损线");
  if (lossStreak >= 2) reasons.push("连续错单达到 2 场，暂停等待下一批数据");
  if (bankroll > 0 && effectivePortfolioFractionValue <= 0) reasons.push("当日剩余止损额度不足");
  return {
    paused: reasons.length > 0,
    reasons,
    maxAllowedLoss,
    currentLoss,
    remainingLossBudget,
    effectivePortfolioFraction: effectivePortfolioFractionValue
  };
}
