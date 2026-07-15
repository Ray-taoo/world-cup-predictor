import { data } from "@/lib/data";
import type { D1Database } from "@/lib/cloudflare";

const EVENTS_BASE = "https://www.thescore.com/worldcup/events";
const EVENT_BASE = "https://www.thescore.com/worldcup/event";

type Score = { homeScore: number; awayScore: number; normalTimeHomeScore?: number; normalTimeAwayScore?: number; extraTimeScore?: string | null; penaltyScore?: string | null; status: string };
type Event = { id: string; startsAt: string; status: string; home: string; away: string; homeScore: number; awayScore: number };

export async function syncWorkerResults(db: D1Database, now = new Date()): Promise<{ checked: number; completed: number; updated: number; failedDates: number }> {
  const matches = data.fixtures.filter((match) => {
    const kickoff = new Date(match.sortDate).getTime();
    return kickoff <= now.getTime() && kickoff >= now.getTime() - 3 * 24 * 60 * 60 * 1000;
  });
  const dates = new Set(matches.flatMap((match) => adjacentDates(match.sortDate)));
  const events: Event[] = [];
  let failedDates = 0;
  for (const date of dates) {
    try {
      const response = await fetch(`${EVENTS_BASE}/${date}`, { headers: { "user-agent": "worldcup-predictor/1.0" } });
      if (!response.ok) throw new Error(`${response.status}`);
      events.push(...parseScheduleEvents(await response.text()));
    } catch {
      failedDates += 1;
    }
  }
  let completed = 0;
  let updated = 0;
  for (const match of matches) {
    const event = events.find((candidate) => sameMatch(match, candidate));
    if (!event || !finished(event.status)) continue;
    let score: Score = { homeScore: event.homeScore, awayScore: event.awayScore, status: normalizeStatus(event.status) };
    if (match.stage !== "group") {
      try {
        const response = await fetch(`${EVENT_BASE}/${event.id}`, { headers: { "user-agent": "worldcup-predictor/1.0" } });
        if (response.ok) score = { ...score, ...parseDetail(await response.text()) };
      } catch {
        // ponytail: retain confirmed final score when detail recovery is unavailable.
      }
    }
    await upsertResult(db, match, event, score);
    completed += 1;
    updated += 1;
  }
  return { checked: matches.length, completed, updated, failedDates };
}

function parseScheduleEvents(html: string): Event[] {
  const events: Event[] = [];
  const pattern = /\{\\"__typename\\":\\"SoccerEvent\\",\\"id\\":\\"SoccerEvent:(\d+)\\"[\s\S]*?\\"startsAt\\":\\"([^"]+)\\"[\s\S]*?\\"eventStatus\\":\\"([^"]+)\\"[\s\S]*?\\"homeTeam\\":\{[\s\S]*?\\"name\\":\\"([^"]+)\\"[\s\S]*?\\"awayTeam\\":\{[\s\S]*?\\"name\\":\\"([^"]+)\\"[\s\S]*?\\"boxScore\\":\{[\s\S]*?\\"homeScore\\":(\d+),\\"awayScore\\":(\d+)/g;
  for (const row of html.matchAll(pattern)) events.push({ id: row[1], startsAt: row[2], status: row[3], home: row[4], away: row[5], homeScore: Number(row[6]), awayScore: Number(row[7]) });
  return events;
}

function parseDetail(html: string): Partial<Score> {
  const decoded = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const match = decoded.match(/"line_scores":\{"home":(\[[\s\S]*?\]),"away":(\[[\s\S]*?\])\}/);
  if (!match) return {};
  try {
    const home = JSON.parse(match[1]) as Array<{ segment_string: string; score: number }>;
    const away = JSON.parse(match[2]) as Array<{ segment_string: string; score: number }>;
    const normalTimeHomeScore = segment(home, ["1", "2"]);
    const normalTimeAwayScore = segment(away, ["1", "2"]);
    const extraHome = segment(home, ["ET1", "ET2"]);
    const extraAway = segment(away, ["ET1", "ET2"]);
    const homeShootout = decoded.match(/"home_shootout_goals":(\d+)/)?.[1];
    const awayShootout = decoded.match(/"away_shootout_goals":(\d+)/)?.[1];
    return {
      normalTimeHomeScore: normalTimeHomeScore ?? undefined, normalTimeAwayScore: normalTimeAwayScore ?? undefined,
      extraTimeScore: extraHome == null || extraAway == null ? null : `${extraHome}-${extraAway}`,
      penaltyScore: homeShootout == null || awayShootout == null ? null : `${homeShootout}-${awayShootout}`
    };
  } catch { return {}; }
}

async function upsertResult(db: D1Database, match: typeof data.fixtures[number], event: Event, score: Score): Promise<void> {
  const now = new Date().toISOString();
  const sourceUrl = `${EVENT_BASE}/${event.id}`;
  const eventKey = JSON.stringify([match.id, event.id, score.status, score.homeScore, score.awayScore, score.normalTimeHomeScore ?? null, score.normalTimeAwayScore ?? null]);
  await db.prepare(`INSERT OR IGNORE INTO result_sync_events (dedupe_key, match_id, external_match_id, source_name, source_url, match_status, home_score, away_score, checked_at, error)
    VALUES (?, ?, ?, 'theScore schedule', ?, ?, ?, ?, ?, NULL)`).bind(eventKey, match.id, event.id, sourceUrl, score.status, score.homeScore, score.awayScore, now).run();
  await db.prepare(`INSERT INTO result_sync_status (match_id, external_match_id, kickoff_time_utc, match_status, home_score, away_score, normal_time_home_score, normal_time_away_score,
    extra_time_score, penalty_score, result_source, result_updated_at, last_result_check_at, result_sync_error, post_match_analysis_status, last_result_source, result_sync_status, result_retry_count, next_retry_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'completed', 'theScore schedule', 'completed', 0, NULL)
    ON CONFLICT(match_id) DO UPDATE SET external_match_id=excluded.external_match_id, match_status=excluded.match_status, home_score=excluded.home_score, away_score=excluded.away_score,
    normal_time_home_score=COALESCE(excluded.normal_time_home_score, result_sync_status.normal_time_home_score), normal_time_away_score=COALESCE(excluded.normal_time_away_score, result_sync_status.normal_time_away_score),
    extra_time_score=COALESCE(excluded.extra_time_score, result_sync_status.extra_time_score), penalty_score=COALESCE(excluded.penalty_score, result_sync_status.penalty_score),
    result_source=excluded.result_source, result_updated_at=excluded.result_updated_at, last_result_check_at=excluded.last_result_check_at, result_sync_error=NULL, result_sync_status='completed', result_retry_count=0, next_retry_at=NULL`)
    .bind(match.id, event.id, match.sortDate, score.status, score.homeScore, score.awayScore, score.normalTimeHomeScore ?? null, score.normalTimeAwayScore ?? null, score.extraTimeScore ?? null, score.penaltyScore ?? null, sourceUrl, now, now).run();
  const current = await db.prepare("SELECT note FROM overrides WHERE match_id=?").bind(match.id).first<Record<string, unknown>>();
  if (!current?.note || String(current.note).startsWith("Automatic result")) {
    await db.prepare(`INSERT INTO overrides (match_id, home_score, away_score, note, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score, away_score=excluded.away_score, note=excluded.note, updated_at=excluded.updated_at`)
      .bind(match.id, score.homeScore, score.awayScore, `Automatic result: theScore ${sourceUrl}`, now).run();
  }
}

function adjacentDates(value: string): string[] { const time = new Date(value).getTime(); return [-1, 0, 1].map((offset) => new Date(time + offset * 86400000).toISOString().slice(0, 10)); }
function sameMatch(match: typeof data.fixtures[number], event: Event): boolean { return normalize(match.home) === normalize(event.home) && normalize(match.away) === normalize(event.away) && Math.abs(new Date(match.sortDate).getTime() - new Date(event.startsAt).getTime()) <= 3 * 60 * 60 * 1000; }
function finished(value: string): boolean { return ["finished", "finished_after_extra_time", "finished_after_penalties"].includes(normalizeStatus(value)); }
function normalizeStatus(value: string): string { const lower = value.toLowerCase(); if (lower.includes("penalt")) return "finished_after_penalties"; if (lower.includes("extra")) return "finished_after_extra_time"; return lower.includes("finished") || lower === "final" ? "finished" : lower; }
function segment(rows: Array<{ segment_string: string; score: number }>, names: string[]): number | null { const values = rows.filter((row) => names.includes(String(row.segment_string))).map((row) => Number(row.score)); return values.length === names.length && values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null; }
function normalize(value: string): string { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase(); }
