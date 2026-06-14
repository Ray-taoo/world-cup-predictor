import fs from "node:fs";
import path from "node:path";
import { data } from "@/lib/data";
import { insertOdds, readTeamInputs } from "@/lib/db";
import { fetchTheOddsApiQuotes } from "@/lib/odds";
import { readNightlySnapshot } from "@/lib/nightly-snapshot";
import { isLineupCheckFresh } from "@/lib/team-freshness";

const stateDir = process.env.WORLD_CUP_DATA_DIR ?? (process.env.VERCEL ? path.join("/tmp", "world-cup-predictor") : path.join(process.cwd(), ".local"));
const statePath = path.join(stateDir, "nightly-refresh.json");

export interface NightlyRefreshState {
  status: "ok" | "error" | "running" | "missing";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  beijingRunDate: string | null;
  targetDate: string | null;
  targetMatches: number;
  oddsFetched: number;
  oddsImported: number;
  oddsMatchIds: string[];
  missingOddsMatchIds: string[];
  lineupPendingMatches: string[];
  note: string;
  error?: string;
}

export function readNightlyRefreshState(): NightlyRefreshState {
  try {
    const snapshot = readNightlySnapshot();
    if (snapshot?.state?.status && !fs.existsSync(statePath)) return snapshot.state;
    if (!fs.existsSync(statePath)) return missingState();
    return { ...missingState(), ...JSON.parse(fs.readFileSync(statePath, "utf8")) };
  } catch {
    return missingState("刷新状态文件读取失败");
  }
}

export async function runNightlyRefresh(apiKey = process.env.ODDS_API_KEY): Promise<NightlyRefreshState> {
  const startedAt = new Date().toISOString();
  writeNightlyRefreshState({
    ...missingState(),
    status: "running",
    lastAttemptAt: startedAt,
    note: "正在执行 21:00 赛前盘口与首发核对刷新"
  });

  try {
    const targetDate = beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    const targetFixtures = data.fixtures.filter((match) => beijingDateKey(match.sortDate) === targetDate);
    const targetMatchIds = new Set(targetFixtures.map((match) => match.id));
    const teamInputs = await readTeamInputs();
    const teamInputMap = new Map(teamInputs.map((input) => [input.teamName, input]));

    let fetchedQuotes = 0;
    let importedQuotes = 0;
    let oddsMatchIds: string[] = [];
    let oddsNote = "未配置 ODDS_API_KEY，今晚未刷新免费赔率";

    if (apiKey) {
      const quotes = await fetchTheOddsApiQuotes(apiKey);
      fetchedQuotes = quotes.length;
      const scopedQuotes = quotes.filter((quote) => targetMatchIds.has(quote.matchId));
      importedQuotes = await insertOdds(scopedQuotes);
      oddsMatchIds = [...new Set(scopedQuotes.map((quote) => quote.matchId))];
      oddsNote = scopedQuotes.length
        ? `已刷新明日 ${oddsMatchIds.length} 场比赛的免费赔率`
        : "The Odds API 当前没有返回明日可匹配赔率";
    }

    const missingOddsMatchIds = targetFixtures
      .filter((match) => !oddsMatchIds.includes(match.id))
      .map((match) => match.id);
    const lineupPendingMatches = targetFixtures
      .filter((match) => !isLineupCheckFresh(teamInputMap.get(match.home)) || !isLineupCheckFresh(teamInputMap.get(match.away)))
      .map((match) => match.id);

    const state: NightlyRefreshState = {
      status: "ok",
      lastAttemptAt: startedAt,
      lastSuccessAt: new Date().toISOString(),
      beijingRunDate: beijingDateKey(startedAt),
      targetDate,
      targetMatches: targetFixtures.length,
      oddsFetched: fetchedQuotes,
      oddsImported: importedQuotes,
      oddsMatchIds,
      missingOddsMatchIds,
      lineupPendingMatches,
      note: `${oddsNote}；首发/伤停自动核对暂未接入，缺失场次会继续提示人工复核。`
    };
    writeNightlyRefreshState(state);
    return state;
  } catch (error) {
    const state: NightlyRefreshState = {
      ...missingState(),
      status: "error",
      lastAttemptAt: startedAt,
      lastSuccessAt: null,
      beijingRunDate: beijingDateKey(startedAt),
      note: "21:00 自动刷新失败",
      error: error instanceof Error ? error.message : "unknown"
    };
    writeNightlyRefreshState(state);
    return state;
  }
}

function writeNightlyRefreshState(state: NightlyRefreshState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function missingState(note = "还没有执行 21:00 赛前刷新"): NightlyRefreshState {
  return {
    status: "missing",
    lastAttemptAt: null,
    lastSuccessAt: null,
    beijingRunDate: null,
    targetDate: null,
    targetMatches: 0,
    oddsFetched: 0,
    oddsImported: 0,
    oddsMatchIds: [],
    missingOddsMatchIds: [],
    lineupPendingMatches: [],
    note
  };
}

function beijingDateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
