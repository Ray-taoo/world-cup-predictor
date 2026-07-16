import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "generated-data.json");
const LIVE_FIXTURES_PATH = path.join(ROOT, "src", "data", "live-fixtures.json");
const SUPPLEMENTAL_RESULTS_PATH = path.join(ROOT, "src", "data", "result-supplements.json");
const WEB_RESULTS_PATH = path.join(ROOT, "src", "data", "result-web-sources.json");
const DB_DIR = path.join(ROOT, ".local");
const DB_PATH = path.join(DB_DIR, "worldcup.sqlite");
const RESULTS_REFRESH_PATH = path.join(DB_DIR, "results-refresh.json");
const RESULT_SYNC_LOCK_PATH = path.join(DB_DIR, "result-sync.lock");
const WORLD_CUP_2026_URL = "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt";
const FIFA_ARTICLE_BASE = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles";
const THESCORE_EVENTS_BASE = "https://www.thescore.com/worldcup/events";
const AUTO_NOTE_PREFIX = "自动抓取赛果";

const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "accept-language": "en-US,en;q=0.9"
};

const aliases = new Map(
  Object.entries({
    "usa": "usa",
    "united states": "usa",
    "united states of america": "usa",
    "korea republic": "south korea",
    "south korea": "south korea",
    "czechia": "czech republic",
    "czech republic": "czech republic",
    "turkiye": "turkey",
    "turkey": "turkey",
    "ir iran": "iran",
    "iran": "iran",
    "cote d ivoire": "ivory coast",
    "ivory coast": "ivory coast",
    "congo dr": "dr congo",
    "dr congo": "dr congo",
    "democratic republic of the congo": "dr congo",
    "cabo verde": "cape verde",
    "cape verde": "cape verde",
    "curacao": "curacao",
    "curaçao": "curacao",
    "bosnia and herzegovina": "bosnia and herzegovina",
    "bosnia herzegovina": "bosnia and herzegovina",
    "bosnia & herzegovina": "bosnia and herzegovina"
  })
);

async function main() {
  const unlock = acquireLock();
  const generated = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  try {
    const fixtures = mergedFixtures(generated);
    let sourceError = null;
    let scored = [];
    try {
      if (process.env.RESULT_SYNC_FORCE_PRIMARY_FAILURE === "1") throw new Error("forced primary source failure");
      const text = await fetchText(WORLD_CUP_2026_URL);
      scored = parseOpenfootballResults(text);
    } catch (error) {
      sourceError = error instanceof Error ? error.message : String(error);
    }
    const matched = matchScoredFixtures(scored, fixtures);
    const supplemental = readSupplementalResults(fixtures);
    const fifaResults = await fetchFifaArticleResults(fixtures, [...matched, ...supplemental]);
    const normalTimeMatchIds = await readNormalTimeMatchIds();
    const theScoreResults = await fetchTheScoreScheduleResults(fixtures, [...matched, ...supplemental, ...fifaResults], normalTimeMatchIds);
    const normalTimeBackfilled = await backfillNormalTimeScores(fixtures);
    const webResults = await fetchWebResults(fixtures, [...matched, ...supplemental, ...theScoreResults, ...fifaResults]);
    const combined = mergeResults([...matched, ...supplemental, ...theScoreResults, ...fifaResults, ...webResults]);
    const summary = await upsertAutoResults(combined);
    const state = {
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      status: sourceError ? "partial" : "ok",
      sourceError,
      scoredFound: scored.length,
      matched: matched.length,
      supplemental: supplemental.length,
      theScoreResults: theScoreResults.length,
      normalTimeBackfilled,
      fifaResults: fifaResults.length,
      webResults: webResults.length,
      combined: combined.length,
      insertedOrUpdated: summary.insertedOrUpdated,
      preservedManual: summary.preservedManual
    };
    fs.writeFileSync(RESULTS_REFRESH_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ source: WORLD_CUP_2026_URL, ...state, unmatched: scored.filter((row) => !matched.some((item) => item.home === row.home && item.away === row.away)).map((row) => `${row.home} ${row.homeScore}-${row.awayScore} ${row.away}`) }, null, 2));
  } finally {
    unlock();
  }
}

function mergedFixtures(generated) {
  const byId = new Map((generated.fixtures ?? []).map((fixture) => [fixture.id, fixture]));
  if (fs.existsSync(LIVE_FIXTURES_PATH)) {
    const live = JSON.parse(fs.readFileSync(LIVE_FIXTURES_PATH, "utf8"));
    for (const fixture of live.fixtures ?? []) byId.set(fixture.id, fixture);
  }
  return [...byId.values()].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
}

function acquireLock() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  try {
    const existing = fs.existsSync(RESULT_SYNC_LOCK_PATH) ? Number(fs.readFileSync(RESULT_SYNC_LOCK_PATH, "utf8")) : 0;
    if (existing && Date.now() - existing > 10 * 60 * 1000) fs.rmSync(RESULT_SYNC_LOCK_PATH, { force: true });
    const fd = fs.openSync(RESULT_SYNC_LOCK_PATH, "wx");
    fs.writeFileSync(fd, String(Date.now()));
    fs.closeSync(fd);
    return () => fs.rmSync(RESULT_SYNC_LOCK_PATH, { force: true });
  } catch {
    console.log(JSON.stringify({ status: "skipped", reason: "result sync already running" }, null, 2));
    process.exit(0);
  }
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function parseOpenfootballResults(text) {
  const rows = [];
  let currentGroup = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const groupMatch = line.match(/^▪\s+Group\s+([A-L])$/);
    if (groupMatch) {
      currentGroup = groupMatch[1];
      continue;
    }
    if (!currentGroup) continue;

    const match = line.match(/^(?:\d{2}:\d{2}\s+UTC[+-]\d+\s+)?(.+?)\s+(\d+)-(\d+)(?:\s+\([^)]+\))?\s+(.+?)\s+@\s+(.+)$/);
    if (!match) continue;
    rows.push({
      group: currentGroup,
      home: canonicalTeam(match[1]),
      away: canonicalTeam(match[4]),
      homeScore: Number(match[2]),
      awayScore: Number(match[3]),
      venue: match[5].trim()
    });
  }
  return rows;
}

function matchScoredFixtures(scored, fixtures) {
  return scored.flatMap((result) => {
    const fixture = fixtures.find(
      (match) =>
        normalizeName(match.home) === normalizeName(result.home) &&
        normalizeName(match.away) === normalizeName(result.away)
    );
    if (!fixture) return [];
    return [
      {
        matchId: fixture.id,
        matchNumber: fixture.matchNumber,
        group: fixture.group,
        home: fixture.home,
        away: fixture.away,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        note: `${AUTO_NOTE_PREFIX}: openfootball/worldcup 2026, ${fixture.home} ${result.homeScore}-${result.awayScore} ${fixture.away}`
      }
    ];
  });
}

function readSupplementalResults(fixtures) {
  if (!fs.existsSync(SUPPLEMENTAL_RESULTS_PATH)) return [];
  const rows = JSON.parse(fs.readFileSync(SUPPLEMENTAL_RESULTS_PATH, "utf8"));
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const fixture = fixtures.find(
      (match) =>
        match.id === row.matchId ||
        (normalizeName(match.home) === normalizeName(row.home ?? "") &&
          normalizeName(match.away) === normalizeName(row.away ?? ""))
    );
    if (!fixture) return [];
    const homeScore = Number(row.homeScore);
    const awayScore = Number(row.awayScore);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return [];
    const sourceName = row.sourceName ? String(row.sourceName) : "supplemental verified result";
    const sourceUrl = row.sourceUrl ? String(row.sourceUrl) : "local supplement";
    return [
      {
        matchId: fixture.id,
        matchNumber: fixture.matchNumber,
        group: fixture.group,
        home: fixture.home,
        away: fixture.away,
        homeScore,
        awayScore,
        note: `${AUTO_NOTE_PREFIX}: ${sourceName}, ${fixture.home} ${homeScore}-${awayScore} ${fixture.away}, ${sourceUrl}`
      }
    ];
  });
}

export function normalizeResultStatus(status) {
  const value = String(status ?? "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (["final", "finished", "full_time", "ft"].includes(value)) return "finished";
  if (["after_extra_time", "finished_after_extra_time", "aet"].includes(value)) return "finished_after_extra_time";
  if (["after_penalties", "finished_after_penalties", "penalties"].includes(value)) return "finished_after_penalties";
  if (["awarded", "walkover"].includes(value)) return "awarded";
  if (["postponed", "delayed"].includes(value)) return "postponed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["abandoned", "suspended"].includes(value)) return "abandoned";
  if (["in_progress", "live", "playing"].includes(value)) return "in_progress";
  if (["halftime", "half_time", "ht"].includes(value)) return "halftime";
  if (["pending", "fetching", "retrying", "failed"].includes(value)) return value;
  return "scheduled";
}

async function fetchTheScoreScheduleResults(fixtures, knownResults, normalTimeMatchIds) {
  const knownIds = new Set(knownResults.map((row) => row.matchId));
  const dates = new Set(
    fixtures
      .filter((match) =>
        (!knownIds.has(match.id) && inRecentSyncWindow(match)) ||
        (match.stage !== "group" && !normalTimeMatchIds.has(match.id) && new Date(match.sortDate).getTime() <= Date.now())
      )
      .flatMap((match) => adjacentUtcDates(match.sortDate))
  );
  const events = [];
  for (const date of dates) {
    try {
      const url = `${THESCORE_EVENTS_BASE}/${date}`;
      const html = await fetchText(url);
      events.push(...parseTheScoreScheduleEvents(html).map((event) => ({ ...event, url })));
    } catch {
      // Keep the rest of the result sync moving; individual misses are audited below.
    }
  }
  const results = [];
  for (const match of fixtures) {
    const needsResult = !knownIds.has(match.id) && inRecentSyncWindow(match);
    const needsNormalTime = match.stage !== "group" && !normalTimeMatchIds.has(match.id) && new Date(match.sortDate).getTime() <= Date.now();
    if (!needsResult && !needsNormalTime) continue;
    const event = selectTheScoreEvent(events, match);
    if (!event) continue;
    const source = {
      externalMatchId: event.externalMatchId,
      url: `https://www.thescore.com/worldcup/event/${event.externalMatchId}`,
      sourceName: "theScore schedule auto"
    };
    if (!isFinishedStatus(event.status) || event.homeScore == null || event.awayScore == null) {
      await recordResultSync(match, source, normalizeResultStatus(event.status), null, "result not final");
      continue;
    }
    let score = { homeScore: event.homeScore, awayScore: event.awayScore };
    if (match.stage !== "group" && !normalTimeMatchIds.has(match.id)) {
      try {
        const detail = parseTheScoreDetail(await fetchText(source.url));
        if (detail) score = reconcileNormalTimeScore({ ...score, ...detail });
      } catch {
        // Keep the final result, but never infer a 90-minute score from it.
      }
      if (event.progressDescription === "Final" && event.segmentShort === "2nd") {
        score = reconcileNormalTimeScore({ ...score, matchStatus: "finished", extraTimeScore: null, penaltyScore: null });
      }
    }
    await recordResultSync(match, source, score.matchStatus ?? "finished", score, null);
    results.push({
      matchId: match.id,
      matchNumber: match.matchNumber,
      group: match.group,
      home: match.home,
      away: match.away,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      normalTimeHomeScore: score.normalTimeHomeScore,
      normalTimeAwayScore: score.normalTimeAwayScore,
      note: `${AUTO_NOTE_PREFIX}: theScore schedule auto, ${match.home} ${score.homeScore}-${score.awayScore} ${match.away}, ${source.url}`
    });
  }
  return results;
}

export function parseTheScoreScheduleEvents(html) {
  const events = [];
  const eventPattern = /\{\\"__typename\\":\\"SoccerEvent\\",\\"id\\":\\"SoccerEvent:(\d+)\\"[\s\S]*?\\"startsAt\\":\\"([^"]+)\\"[\s\S]*?\\"eventStatus\\":\\"([^"]+)\\"[\s\S]*?\\"homeTeam\\":\{[\s\S]*?\\"name\\":\\"([^"]+)\\"[\s\S]*?\\"awayTeam\\":\{[\s\S]*?\\"name\\":\\"([^"]+)\\"[\s\S]*?\\"boxScore\\":\{[\s\S]*?\\"homeScore\\":(\d+),\\"awayScore\\":(\d+)/g;
  for (const found of html.matchAll(eventPattern)) {
    const nextEvent = html.indexOf('{\\"__typename\\":\\"SoccerEvent\\"', found.index + 1);
    const eventHtml = html.slice(found.index, nextEvent < 0 ? found.index + 3000 : nextEvent);
    const progress = eventHtml.match(/\\"progress\\":\{[\s\S]*?\\"description\\":\\"([^\"]+)\\"[\s\S]*?\\"segmentShort\\":\\"([^\"]+)\\"/);
    events.push({
      externalMatchId: found[1],
      startsAt: found[2],
      status: found[3],
      home: found[4],
      away: found[5],
      homeScore: Number(found[6]),
      awayScore: Number(found[7]),
      progressDescription: progress?.[1] ?? null,
      segmentShort: progress?.[2] ?? null
    });
  }
  return events;
}

export function selectTheScoreEvent(events, match) {
  const candidates = events.filter((event) => sameMatch(match, event));
  return candidates.find((event) => event.progressDescription === "Final" && event.segmentShort != null)
    ?? candidates.find((event) => isFinishedStatus(event.status))
    ?? candidates[0];
}

export function parseTheScoreDetail(html) {
  const decoded = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const lineScores = decoded.match(/"line_scores":\{"home":(\[[\s\S]*?\]),"away":(\[[\s\S]*?\])\}/);
  if (!lineScores) return null;
  try {
    const homeLines = JSON.parse(lineScores[1]);
    const awayLines = JSON.parse(lineScores[2]);
    const normalTimeHomeScore = segmentScore(homeLines, ["1", "2"]);
    const normalTimeAwayScore = segmentScore(awayLines, ["1", "2"]);
    if (normalTimeHomeScore == null || normalTimeAwayScore == null) return null;
    const extraHome = segmentScore(homeLines, ["ET1", "ET2"]);
    const extraAway = segmentScore(awayLines, ["ET1", "ET2"]);
    const homeShootout = decoded.match(/"home_shootout_goals":(\d+)/)?.[1] ?? null;
    const awayShootout = decoded.match(/"away_shootout_goals":(\d+)/)?.[1] ?? null;
    const penaltyScore = homeShootout != null && awayShootout != null ? `${homeShootout}-${awayShootout}` : null;
    const extraTimeScore = extraHome == null || extraAway == null ? null : `${extraHome}-${extraAway}`;
    return {
      normalTimeHomeScore,
      normalTimeAwayScore,
      extraTimeScore,
      penaltyScore,
      matchStatus: penaltyScore ? "finished_after_penalties" : extraTimeScore ? "finished_after_extra_time" : "finished"
    };
  } catch {
    return null;
  }
}

async function backfillNormalTimeScores(fixtures) {
  if (!fs.existsSync(DB_PATH)) return 0;
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
  let rows = [];
  try {
    const columns = new Set((db.exec("PRAGMA table_info(result_sync_status)")[0]?.values ?? []).map((row) => String(row[1])));
    if (!columns.has("normal_time_home_score")) return 0;
    rows = (db.exec(`
      SELECT match_id, external_match_id, home_score, away_score
      FROM result_sync_status
      WHERE normal_time_home_score IS NULL
        AND normal_time_away_score IS NULL
        AND external_match_id IS NOT NULL
        AND result_source LIKE '%thescore.com/worldcup/event/%'
    `)[0]?.values ?? []).map((row) => ({
      matchId: String(row[0]),
      eventId: String(row[1]),
      homeScore: Number(row[2]),
      awayScore: Number(row[3])
    }));
  } finally {
    db.close();
  }

  let backfilled = 0;
  for (const row of rows) {
    const match = fixtures.find((fixture) => fixture.id === row.matchId);
    if (!match || match.stage === "group") continue;
    const source = { externalMatchId: row.eventId, sourceName: "theScore event detail", url: `https://www.thescore.com/worldcup/event/${row.eventId}` };
    try {
      const detail = parseTheScoreDetail(await fetchText(source.url));
      if (!detail) continue;
      const score = reconcileNormalTimeScore({ homeScore: row.homeScore, awayScore: row.awayScore, ...detail });
      await recordResultSync(match, source, detail.matchStatus, score, null);
      backfilled += 1;
    } catch {
      // Retry this single missing 90-minute score on the next automatic refresh.
    }
  }
  return backfilled;
}

function segmentScore(lines, segments) {
  const selected = lines.filter((line) => segments.includes(String(line.segment_string))).map((line) => Number(line.score));
  return selected.length === segments.length && selected.every(Number.isFinite) ? selected.reduce((sum, score) => sum + score, 0) : null;
}

function adjacentUtcDates(value) {
  const base = new Date(value);
  return [-1, 0, 1].map((offset) => {
    const date = new Date(base.getTime() + offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  });
}

function sameMatch(match, event) {
  const sameTeams = normalizeName(match.home) === normalizeName(event.home) && normalizeName(match.away) === normalizeName(event.away);
  const closeKickoff = Math.abs(new Date(match.sortDate).getTime() - new Date(event.startsAt).getTime()) <= 3 * 60 * 60 * 1000;
  return sameTeams && closeKickoff;
}

function isFinishedStatus(status) {
  return ["finished", "finished_after_extra_time", "finished_after_penalties"].includes(normalizeResultStatus(status));
}

async function fetchFifaArticleResults(fixtures, knownResults) {
  const knownIds = new Set(knownResults.map((row) => row.matchId));
  const results = [];
  for (const match of fixtures) {
    if (knownIds.has(match.id) || !shouldUseFifaFallback(match)) continue;
    let lastError = "fifa result page not found";
    for (const url of fifaArticleCandidates(match)) {
      try {
        const html = await fetchText(url);
        const score = parseArticleResult(html, match);
        if (!score) {
          lastError = "score not found";
          continue;
        }
        const source = { externalMatchId: fifaExternalId(url), url, sourceName: "FIFA auto article" };
        await recordResultSync(match, source, "finished", score, null);
        results.push({
          matchId: match.id,
          matchNumber: match.matchNumber,
          group: match.group,
          home: match.home,
          away: match.away,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          note: `${AUTO_NOTE_PREFIX}: FIFA auto article, ${match.home} ${score.homeScore}-${score.awayScore} ${match.away}, ${url}`
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!results.some((row) => row.matchId === match.id)) {
      await recordResultSync(match, { externalMatchId: null, url: FIFA_ARTICLE_BASE, sourceName: "FIFA auto article" }, "retrying", null, lastError);
    }
  }
  return results;
}

function needsResultRecovery(match) {
  const kickoff = new Date(match.sortDate).getTime();
  const now = Date.now();
  return kickoff <= now && inRecentSyncWindow(match);
}

function shouldUseFifaFallback(match) {
  const kickoff = new Date(match.sortDate).getTime();
  return inRecentSyncWindow(match) && kickoff <= Date.now() - 4 * 60 * 60 * 1000;
}

function inRecentSyncWindow(match) {
  const kickoff = new Date(match.sortDate).getTime();
  const now = Date.now();
  return kickoff >= now - 3 * 24 * 60 * 60 * 1000 && kickoff <= now + 2 * 24 * 60 * 60 * 1000;
}

export function fifaArticleCandidates(match) {
  const home = slugTeam(match.home);
  const away = slugTeam(match.away);
  const pairs = [`${home}-${away}`, `${away}-${home}`];
  const suffixes = ["match-report-highlights"];
  return pairs.flatMap((pair) => suffixes.map((suffix) => `${FIFA_ARTICLE_BASE}/${pair}-${suffix}`));
}

function fifaExternalId(url) {
  return url.split("/").pop() ?? url;
}

function slugTeam(value) {
  return normalizeName(value).replace(/\band\b/g, "").replace(/\s+/g, "-");
}

async function fetchWebResults(fixtures, knownResults) {
  if (!fs.existsSync(WEB_RESULTS_PATH)) return [];
  const knownIds = new Set(knownResults.map((row) => row.matchId));
  const rows = JSON.parse(fs.readFileSync(WEB_RESULTS_PATH, "utf8"));
  if (!Array.isArray(rows)) return [];
  const results = [];
  for (const row of rows) {
    const match = fixtures.find((fixture) => fixture.id === row.matchId);
    if (!match || knownIds.has(match.id) || new Date(match.sortDate).getTime() > Date.now()) continue;
    const url = String(row.url ?? "");
    if (!url) continue;
    try {
      const html = await fetchText(url);
      const score = parseTheScoreEvent(html, match) ?? parseArticleResult(html, match);
      const status = score ? "finished" : "scheduled";
      await recordResultSync(match, row, status, score, score ? null : "score not found");
      if (!score) continue;
      results.push({
        matchId: match.id,
        matchNumber: match.matchNumber,
        group: match.group,
        home: match.home,
        away: match.away,
        homeScore: score.homeScore,
        awayScore: score.awayScore,
        note: `${AUTO_NOTE_PREFIX}: ${row.sourceName ?? "web result source"}, ${match.home} ${score.homeScore}-${score.awayScore} ${match.away}, ${url}`
      });
    } catch {
      await recordResultSync(match, row, "scheduled", null, "web source failed");
      // ponytail: skip flaky web source; openfootball/supplements still run.
    }
  }
  return results;
}

export function parseTheScoreEvent(html, match) {
  const text = decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const segment = text.match(/MATCHUP\s+[\s\S]+?\s+(?:FOX|FS1)\s+([\s\S]+?)\s+Timeline\b/i)?.[1] ?? text;
  const home = normalizeName(match.home);
  const away = normalizeName(match.away);
  const homeAway = text.match(new RegExp(`${escapeRegExp(match.home)}\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+${escapeRegExp(match.away)}`, "i"));
  if (homeAway) return { homeScore: Number(homeAway[1]), awayScore: Number(homeAway[2]) };
  const awayHome = text.match(new RegExp(`${escapeRegExp(match.away)}\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+${escapeRegExp(match.home)}`, "i"));
  if (awayHome) return { homeScore: Number(awayHome[2]), awayScore: Number(awayHome[1]) };
  const teamPattern = "[A-Za-z .()&'\\-]+";
  const scoreboard = new RegExp(`(${teamPattern}?)\\s+\\d+-\\d+-\\d+[^A-Za-z]+.*?\\s(\\d+)\\s+(${teamPattern}?)\\s+\\d+-\\d+-\\d+.*?\\s(\\d+)(?=\\s|$)`, "g");
  for (const found of segment.matchAll(scoreboard)) {
    const left = normalizeName(found[1]);
    const right = normalizeName(found[3]);
    if (left === home && right === away) return { homeScore: Number(found[2]), awayScore: Number(found[4]) };
    if (left === away && right === home) return { homeScore: Number(found[4]), awayScore: Number(found[2]) };
  }
  return null;
}

export function parseArticleResult(html, match) {
  const text = decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const home = normalizeName(match.home);
  const away = normalizeName(match.away);
  const homeAway = text.match(new RegExp(`${escapeRegExp(match.home)}\\s+(\\d+)\\s*[-\\u2013\\u2014]\\s*(\\d+)\\s+${escapeRegExp(match.away)}`, "i"));
  if (homeAway) return { homeScore: Number(homeAway[1]), awayScore: Number(homeAway[2]) };
  const awayHome = text.match(new RegExp(`${escapeRegExp(match.away)}\\s+(\\d+)\\s*[-\\u2013\\u2014]\\s*(\\d+)\\s+${escapeRegExp(match.home)}`, "i"));
  if (awayHome) return { homeScore: Number(awayHome[2]), awayScore: Number(awayHome[1]) };
  const teamPattern = "[A-Za-z .()&'\\-]+";
  const direct = new RegExp(`(${teamPattern})\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+(${teamPattern})`, "g");
  for (const found of text.matchAll(direct)) {
    const left = normalizeName(found[1]);
    const right = normalizeName(found[4]);
    if (left === home && right === away) return { homeScore: Number(found[2]), awayScore: Number(found[3]) };
    if (left === away && right === home) return { homeScore: Number(found[3]), awayScore: Number(found[2]) };
  }
  const win = text.match(new RegExp(`(${teamPattern})['’]?s\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+win\\s+over\\s+(${teamPattern})`, "i"));
  if (win) {
    const winner = normalizeName(win[1]);
    const loser = normalizeName(win[4]);
    if (winner === home && loser === away) return { homeScore: Number(win[2]), awayScore: Number(win[3]) };
    if (winner === away && loser === home) return { homeScore: Number(win[3]), awayScore: Number(win[2]) };
  }
  const homeWin = text.match(new RegExp(`${escapeRegExp(match.home)}['’]?s\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+win\\s+over\\s+${escapeRegExp(match.away)}`, "i"));
  if (homeWin) return { homeScore: Number(homeWin[1]), awayScore: Number(homeWin[2]) };
  const awayWin = text.match(new RegExp(`${escapeRegExp(match.away)}['’]?s\\s+(\\d+)\\s*[-–]\\s*(\\d+)\\s+win\\s+over\\s+${escapeRegExp(match.home)}`, "i"));
  if (awayWin) return { homeScore: Number(awayWin[2]), awayScore: Number(awayWin[1]) };
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function mergeResults(results) {
  const byMatchId = new Map();
  for (const result of results) {
    const existing = byMatchId.get(result.matchId);
    if (existing && (existing.homeScore !== result.homeScore || existing.awayScore !== result.awayScore)) {
      // ponytail: first trusted source wins; raw conflict lives in result_sync_events if deeper audit is needed.
      continue;
    }
    byMatchId.set(result.matchId, result);
  }
  return [...byMatchId.values()].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
}

async function upsertAutoResults(results) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file)
  });
  const db = fs.existsSync(DB_PATH) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH))) : new SQL.Database();
  ensureSchema(db);

  let insertedOrUpdated = 0;
  let preservedManual = 0;
  const now = new Date().toISOString();
  for (const result of results) {
    const current = db.exec("SELECT note FROM overrides WHERE match_id = ?", [result.matchId])[0]?.values?.[0];
    const note = current?.[0] == null ? null : String(current[0]);
    if (note && !note.startsWith(AUTO_NOTE_PREFIX)) {
      preservedManual += 1;
      continue;
    }
    db.run(
      `INSERT INTO overrides (match_id, home_score, away_score, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         home_score = excluded.home_score,
         away_score = excluded.away_score,
         note = excluded.note,
         updated_at = excluded.updated_at`,
      [
        result.matchId,
        result.homeScore,
        result.awayScore,
        result.note ?? `${AUTO_NOTE_PREFIX}: openfootball/worldcup 2026, ${result.home} ${result.homeScore}-${result.awayScore} ${result.away}`,
        now
      ]
    );
    insertedOrUpdated += 1;
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  return { insertedOrUpdated, preservedManual };
}

async function recordResultSync(match, source, status, score, error) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file)
  });
  const db = fs.existsSync(DB_PATH) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH))) : new SQL.Database();
  ensureSchema(db);
  const now = new Date().toISOString();
  const existingRetryCount = Number(
    db.exec(`SELECT result_retry_count FROM result_sync_status WHERE match_id = ?`, [match.id])[0]?.values?.[0]?.[0] ?? 0
  );
  const retryCount = score ? 0 : existingRetryCount + 1;
  const externalMatchId = source.externalMatchId == null ? null : String(source.externalMatchId);
  const normalizedStatus = normalizeResultStatus(status);
  if (score?.normalTimeHomeScore != null && score.normalTimeAwayScore != null) {
    score = reconcileNormalTimeScore({ ...score, matchStatus: normalizedStatus });
  }
  const dedupeKey = JSON.stringify([
    match.id,
    externalMatchId,
    source.sourceName ?? null,
    source.url ?? null,
    normalizedStatus,
    score?.homeScore ?? null,
    score?.awayScore ?? null,
    error ?? null
  ]);
  db.run(
    `INSERT OR IGNORE INTO result_sync_events (
       dedupe_key, match_id, external_match_id, source_name, source_url, match_status,
       home_score, away_score, checked_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dedupeKey,
      match.id,
      externalMatchId,
      source.sourceName ?? null,
      source.url ?? null,
      normalizedStatus,
      score?.homeScore ?? null,
      score?.awayScore ?? null,
      now,
      error
    ]
  );
  db.run(
    `INSERT INTO result_sync_status (
       match_id, external_match_id, kickoff_time_utc, match_status, home_score, away_score, normal_time_home_score, normal_time_away_score,
       extra_time_score, penalty_score, result_source, result_updated_at, last_result_check_at,
       result_sync_error, post_match_analysis_status, last_result_source, result_sync_status,
       result_retry_count, next_retry_at
     )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       external_match_id = excluded.external_match_id,
       kickoff_time_utc = excluded.kickoff_time_utc,
      match_status = excluded.match_status,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      normal_time_home_score = COALESCE(excluded.normal_time_home_score, normal_time_home_score),
      normal_time_away_score = COALESCE(excluded.normal_time_away_score, normal_time_away_score),
      extra_time_score = COALESCE(excluded.extra_time_score, extra_time_score),
      penalty_score = COALESCE(excluded.penalty_score, penalty_score),
       result_source = excluded.result_source,
       result_updated_at = excluded.result_updated_at,
       last_result_check_at = excluded.last_result_check_at,
       result_sync_error = excluded.result_sync_error,
       post_match_analysis_status = excluded.post_match_analysis_status,
       last_result_source = excluded.last_result_source,
       result_sync_status = excluded.result_sync_status,
       result_retry_count = excluded.result_retry_count,
       next_retry_at = excluded.next_retry_at`,
    [
      match.id,
      source.externalMatchId == null ? null : String(source.externalMatchId),
      new Date(match.sortDate).toISOString(),
      normalizeResultStatus(status),
      score?.homeScore ?? null,
      score?.awayScore ?? null,
      score?.normalTimeHomeScore ?? null,
      score?.normalTimeAwayScore ?? null,
      score?.extraTimeScore ?? null,
      score?.penaltyScore ?? null,
      source.url ?? null,
      score ? now : null,
      now,
      error,
      postMatchAnalysisStatus(score, null),
      source.sourceName ?? source.url ?? null,
      score ? "completed" : normalizeResultStatus(status),
      retryCount,
      score ? null : nextRetryAt(retryCount)
    ]
  );
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
}

export function postMatchAnalysisStatus(score, analysisError) {
  if (!score) return "pending";
  return analysisError ? "pending" : "completed";
}

function ensureSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS overrides (
      match_id TEXT PRIMARY KEY,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      note TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS result_sync_status (
      match_id TEXT PRIMARY KEY,
      external_match_id TEXT,
      kickoff_time_utc TEXT NOT NULL,
      match_status TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      normal_time_home_score INTEGER,
      normal_time_away_score INTEGER,
      extra_time_score TEXT,
      penalty_score TEXT,
      result_source TEXT,
      result_updated_at TEXT,
      last_result_check_at TEXT NOT NULL,
      result_sync_error TEXT,
      post_match_analysis_status TEXT NOT NULL DEFAULT 'pending',
      last_result_source TEXT,
      result_sync_status TEXT NOT NULL DEFAULT 'pending',
      result_retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT
    );
  `);
  ensureColumn(db, "result_sync_status", "last_result_source", "TEXT");
  ensureColumn(db, "result_sync_status", "normal_time_home_score", "INTEGER");
  ensureColumn(db, "result_sync_status", "normal_time_away_score", "INTEGER");
  ensureColumn(db, "result_sync_status", "result_sync_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, "result_sync_status", "result_retry_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "result_sync_status", "next_retry_at", "TEXT");
  db.run(`
    CREATE TABLE IF NOT EXISTS result_sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL,
      match_id TEXT NOT NULL,
      external_match_id TEXT,
      source_name TEXT,
      source_url TEXT,
      match_status TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      checked_at TEXT NOT NULL,
      error TEXT
    );
  `);
  ensureColumn(db, "result_sync_events", "dedupe_key", "TEXT");
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS result_sync_events_dedupe_key_idx ON result_sync_events(dedupe_key)`);
}

function nextRetryAt(retryCount) {
  const minutes = Math.min(240, 15 * 2 ** Math.max(0, retryCount - 1));
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function ensureColumn(db, table, column, definition) {
  const columns = new Set((db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => row[1]));
  if (!columns.has(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function readNormalTimeMatchIds() {
  if (!fs.existsSync(DB_PATH)) return new Set();
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
  try {
    const columns = new Set((db.exec("PRAGMA table_info(result_sync_status)")[0]?.values ?? []).map((row) => String(row[1])));
    if (!columns.has("normal_time_home_score") || !columns.has("normal_time_away_score")) return new Set();
    const rows = db.exec(`
      SELECT match_id, match_status, home_score, away_score,
             normal_time_home_score, normal_time_away_score, extra_time_score, penalty_score
      FROM result_sync_status
    `)[0]?.values ?? [];
    return new Set(rows.filter((row) => normalTimeScoreIsUsable({
      matchStatus: row[1], homeScore: row[2], awayScore: row[3],
      normalTimeHomeScore: row[4], normalTimeAwayScore: row[5],
      extraTimeScore: row[6], penaltyScore: row[7]
    })).map((row) => String(row[0])));
  } finally {
    db.close();
  }
}

export function normalTimeScoreIsUsable(score) {
  if (score.normalTimeHomeScore == null || score.normalTimeAwayScore == null) return false;
  if (normalizeResultStatus(score.matchStatus) !== "finished") return true;
  if (score.extraTimeScore != null || score.penaltyScore != null) return true;
  return Number(score.normalTimeHomeScore) === Number(score.homeScore)
    && Number(score.normalTimeAwayScore) === Number(score.awayScore);
}

export function reconcileNormalTimeScore(score) {
  if (normalizeResultStatus(score.matchStatus) !== "finished") return score;
  if (score.extraTimeScore != null || score.penaltyScore != null) return score;
  return { ...score, normalTimeHomeScore: score.homeScore, normalTimeAwayScore: score.awayScore };
}

function canonicalTeam(name) {
  return name.replace(/\s+/g, " ").trim();
}

function normalizeName(name) {
  const normalized = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  return aliases.get(normalized) ?? normalized;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
