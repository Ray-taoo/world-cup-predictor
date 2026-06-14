import type { Fixture } from "@/lib/types";

export const MAX_BUY_WINDOW_HOURS = 72;

export type MatchTimingStatus = "临场窗口" | "等待临场" | "已开赛" | "时间无效";

export interface MatchTiming {
  hoursUntilKickoff: number | null;
  inBuyingWindow: boolean;
  status: MatchTimingStatus;
  text: string;
}

export function matchTiming(match: Fixture, now = new Date()): MatchTiming {
  const kickoff = new Date(match.sortDate).getTime();
  if (!Number.isFinite(kickoff)) {
    return {
      hoursUntilKickoff: null,
      inBuyingWindow: false,
      status: "时间无效",
      text: "比赛时间无效，不能进入买入区"
    };
  }
  const hoursUntilKickoff = (kickoff - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilKickoff < 0) {
    return {
      hoursUntilKickoff,
      inBuyingWindow: false,
      status: "已开赛",
      text: "比赛已开赛或已结束，不再给买入建议"
    };
  }
  if (hoursUntilKickoff <= MAX_BUY_WINDOW_HOURS) {
    return {
      hoursUntilKickoff,
      inBuyingWindow: true,
      status: "临场窗口",
      text: `距离开赛 ${formatHours(hoursUntilKickoff)}，允许临场确认`
    };
  }
  return {
    hoursUntilKickoff,
    inBuyingWindow: false,
    status: "等待临场",
    text: `距离开赛 ${formatHours(hoursUntilKickoff)}，暂不进入严格买入`
  };
}

function formatHours(hours: number): string {
  if (hours < 24) return `${Math.max(0, Math.round(hours))} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

