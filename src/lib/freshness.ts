import type { OddsQuote } from "@/lib/types";

export const MAX_BUY_ODDS_AGE_HOURS = 48;

export function oddsAgeHours(odds: OddsQuote | null, now = new Date()): number | null {
  if (!odds) return null;
  const fetched = new Date(odds.fetchedAt).getTime();
  if (!Number.isFinite(fetched)) return null;
  return Math.max(0, (now.getTime() - fetched) / 36e5);
}

export function isOddsFreshForBuying(odds: OddsQuote | null, now = new Date()): boolean {
  if (!odds) return false;
  if (odds.quoteType === "opening") return false;
  const age = oddsAgeHours(odds, now);
  return age != null && age <= MAX_BUY_ODDS_AGE_HOURS;
}

export function oddsFreshnessText(odds: OddsQuote | null, now = new Date()): string {
  if (!odds) return "缺少盘口价格";
  const age = oddsAgeHours(odds, now);
  if (age == null) return "盘口时间无效";
  if (isOddsFreshForBuying(odds, now)) return `盘口 ${formatAge(age)} 内更新`;
  return `盘口已 ${formatAge(age)} 未更新`;
}

function formatAge(hours: number): string {
  if (hours < 1) return "1 小时";
  if (hours < 48) return `${Math.round(hours)} 小时`;
  return `${Math.round(hours / 24)} 天`;
}
