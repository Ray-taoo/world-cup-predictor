import type { TeamInput } from "@/lib/types";

export const MAX_TEAM_INPUT_AGE_DAYS = 14;
export const MAX_LINEUP_CHECK_AGE_HOURS = 24;

export function teamInputAgeDays(input: TeamInput | null | undefined): number | null {
  if (!input) return null;
  const updatedAt = new Date(input.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return null;
  return Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
}

export function isTeamInputFresh(input: TeamInput | null | undefined): boolean {
  const age = teamInputAgeDays(input);
  return age != null && age <= MAX_TEAM_INPUT_AGE_DAYS;
}

export function teamInputFreshnessText(input: TeamInput | null | undefined): string {
  if (!input) return "缺少球队补充数据";
  const age = teamInputAgeDays(input);
  if (age == null) return "球队补充数据时间无效";
  const days = Math.floor(age);
  if (age <= MAX_TEAM_INPUT_AGE_DAYS) return `球队补充数据 ${days} 天内更新`;
  return `球队补充数据已过期 ${days} 天`;
}

export function lineupCheckAgeHours(input: TeamInput | null | undefined): number | null {
  if (!input?.lineupCheckedAt) return null;
  const checkedAt = new Date(input.lineupCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return null;
  return Math.max(0, (Date.now() - checkedAt) / (1000 * 60 * 60));
}

export function isLineupCheckFresh(input: TeamInput | null | undefined): boolean {
  const age = lineupCheckAgeHours(input);
  return age != null && age <= MAX_LINEUP_CHECK_AGE_HOURS;
}

export function lineupCheckFreshnessText(input: TeamInput | null | undefined): string {
  if (!input) return "缺少球队补充数据";
  const age = lineupCheckAgeHours(input);
  if (age == null) return "未做临场阵容/伤停核对";
  const hours = Math.floor(age);
  if (age <= MAX_LINEUP_CHECK_AGE_HOURS) return `临场核对 ${hours} 小时内完成`;
  return `临场核对已超过 ${hours} 小时`;
}
