import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "generated-data.json");
const DB_DIR = path.join(ROOT, ".local");
const DB_PATH = path.join(DB_DIR, "worldcup.sqlite");
const STATE_PATH = path.join(DB_DIR, "api-football-sync.json");
const LOCK_PATH = path.join(DB_DIR, "api-football-sync.lock");
const DAILY_REQUEST_LIMIT = 96;
const AUTO_NOTE_PREFIX = "自动抓取赛果";

loadEnvLocal();

async function main() {
  const unlock = acquireLock();
  try {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY is not configured");

    const startedAt = new Date().toISOString();
    const schemaDb = await openDb();
    persist(schemaDb);
    const requestUsage = reserveApiRequest(startedAt);
    const payload = await fetchApiFootball(apiKey);
    const generated = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const fixtures = generated.fixtures ?? [];
    const db = await openDb();
    const summary = syncFixtures(db, fixtures, payload.response ?? []);
    persist(db);

    const state = writeState({ status: "ok", lastAttemptAt: startedAt, lastSuccessAt: new Date().toISOString(), ...requestUsage, ...summary });
    console.log(JSON.stringify(maskState(state), null, 2));
  } catch (error) {
    const state = writeState({
      status: "error",
      lastAttemptAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
    console.log(JSON.stringify(state, null, 2));
    process.exitCode = 1;
  } finally {
    unlock();
  }
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
}

function acquireLock() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  try {
    const existing = fs.existsSync(LOCK_PATH) ? Number(fs.readFileSync(LOCK_PATH, "utf8")) : 0;
    if (existing && Date.now() - existing > 10 * 60 * 1000) fs.rmSync(LOCK_PATH, { force: true });
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, String(Date.now()));
    fs.closeSync(fd);
    return () => fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    console.log(JSON.stringify({ status: "skipped", reason: "api-football sync already running" }, null, 2));
    process.exit(0);
  }
}

async function fetchApiFootball(apiKey) {
  const url = "https://v3.football.api-sports.io/fixtures?league=1&season=2026";
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: { "x-apisports-key": apiKey },
        signal: controller.signal
      });
      const body = await response.json();
      if (response.status === 429) {
        const error = new Error(`API-Football rate limited: ${JSON.stringify(body.errors ?? {})}; limit=${response.headers.get("x-ratelimit-requests-limit") ?? "?"}; remaining=${response.headers.get("x-ratelimit-requests-remaining") ?? "?"}; retry-after=${response.headers.get("retry-after") ?? "?"}`);
        error.retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
        error.retryable = true;
        throw error;
      }
      const errors = body.errors && Object.keys(body.errors).length ? JSON.stringify(body.errors) : "";
      if (!response.ok || errors) {
        const error = new Error(`API-Football ${response.status}: ${errors || response.statusText}`);
        error.retryable = response.status >= 500;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === 3) break;
      const retryAfterMs = Number(error?.retryAfterMs ?? 0);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs > 0 ? retryAfterMs : 500 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const state = { ...readState(), ...patch };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function reserveApiRequest(isoNow) {
  const usage = nextRequestUsage(readState(), isoNow);
  writeState({ status: "request_reserved", lastAttemptAt: isoNow, ...usage });
  return usage;
}

export function nextRequestUsage(state, isoNow = new Date().toISOString(), limit = DAILY_REQUEST_LIMIT) {
  const requestDay = String(isoNow).slice(0, 10);
  const used = state?.requestDay === requestDay ? Number(state.requestsUsedToday ?? 0) : 0;
  if (used >= limit) throw new Error(`API-Football daily request guard reached ${used}/${limit}`);
  return { requestDay, requestsUsedToday: used + 1, requestLimit: limit };
}

async function openDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  const db = fs.existsSync(DB_PATH) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH))) : new SQL.Database();
  ensureSchema(db);
  return db;
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
    CREATE TABLE IF NOT EXISTS api_football_fixtures (
      external_match_id INTEGER PRIMARY KEY,
      local_match_id TEXT,
      provider TEXT NOT NULL,
      kickoff_time_utc TEXT,
      external_status TEXT,
      external_status_long TEXT,
      home_team_external_id INTEGER,
      away_team_external_id INTEGER,
      home_team_name TEXT,
      away_team_name TEXT,
      home_score INTEGER,
      away_score INTEGER,
      halftime_score TEXT,
      fulltime_score TEXT,
      extra_time_score TEXT,
      penalty_score TEXT,
      home_winner INTEGER,
      away_winner INTEGER,
      result_updated_at TEXT,
      raw_result_json TEXT NOT NULL,
      sync_error TEXT
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
      extra_time_score TEXT,
      penalty_score TEXT,
      home_winner INTEGER,
      away_winner INTEGER,
      result_source TEXT,
      result_updated_at TEXT,
      last_result_check_at TEXT NOT NULL,
      result_sync_error TEXT,
      post_match_analysis_status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  addColumn(db, "api_football_fixtures", "home_winner INTEGER");
  addColumn(db, "api_football_fixtures", "away_winner INTEGER");
  addColumn(db, "result_sync_status", "home_winner INTEGER");
  addColumn(db, "result_sync_status", "away_winner INTEGER");
}

function addColumn(db, table, columnSql) {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
  } catch {
    // ponytail: SQLite has no ADD COLUMN IF NOT EXISTS; duplicate-column error means the migration already ran.
  }
}

function syncFixtures(db, localFixtures, apiRows) {
  let apiRowsSaved = 0;
  let matched = 0;
  let finished = 0;
  let overridesWritten = 0;
  const failures = [];
  const now = new Date().toISOString();

  for (const row of apiRows) {
    const fixture = row.fixture ?? {};
    const teams = row.teams ?? {};
    const goals = row.goals ?? {};
    const score = row.score ?? {};
    const externalId = fixture.id;
    if (externalId == null) continue;
    const local = matchLocalFixture(localFixtures, row);
    if (local) matched += 1;
    else failures.push(`${externalId}: ${teams.home?.name ?? "?"} vs ${teams.away?.name ?? "?"} ${fixture.date ?? ""}`);

    db.run(
      `INSERT INTO api_football_fixtures (
        external_match_id, local_match_id, provider, kickoff_time_utc, external_status,
        external_status_long, home_team_external_id, away_team_external_id, home_team_name,
        away_team_name, home_score, away_score, halftime_score, fulltime_score,
        extra_time_score, penalty_score, home_winner, away_winner, result_updated_at, raw_result_json, sync_error
      ) VALUES (?, ?, 'api-football', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_match_id) DO UPDATE SET
        local_match_id = excluded.local_match_id,
        kickoff_time_utc = excluded.kickoff_time_utc,
        external_status = excluded.external_status,
        external_status_long = excluded.external_status_long,
        home_team_external_id = excluded.home_team_external_id,
        away_team_external_id = excluded.away_team_external_id,
        home_team_name = excluded.home_team_name,
        away_team_name = excluded.away_team_name,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        halftime_score = excluded.halftime_score,
        fulltime_score = excluded.fulltime_score,
        extra_time_score = excluded.extra_time_score,
        penalty_score = excluded.penalty_score,
        home_winner = excluded.home_winner,
        away_winner = excluded.away_winner,
        result_updated_at = excluded.result_updated_at,
        raw_result_json = excluded.raw_result_json,
        sync_error = excluded.sync_error`,
      [
        externalId,
        local?.id ?? null,
        fixture.date ?? null,
        fixture.status?.short ?? null,
        fixture.status?.long ?? null,
        teams.home?.id ?? null,
        teams.away?.id ?? null,
        teams.home?.name ?? null,
        teams.away?.name ?? null,
        integerOrNull(goals.home),
        integerOrNull(goals.away),
        scorePair(score.halftime),
        scorePair(score.fulltime),
        scorePair(score.extratime),
        scorePair(score.penalty),
        winnerFlag(teams.home?.winner),
        winnerFlag(teams.away?.winner),
        now,
        JSON.stringify(row),
        local ? null : "local fixture not matched"
      ]
    );
    apiRowsSaved += 1;

    const status = mapStatus(fixture.status?.short);
    if (!local) continue;
    db.run(
      `INSERT INTO result_sync_status (
        match_id, external_match_id, kickoff_time_utc, match_status, home_score, away_score,
        extra_time_score, penalty_score, home_winner, away_winner, result_source, result_updated_at, last_result_check_at,
        result_sync_error, post_match_analysis_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET
        external_match_id = excluded.external_match_id,
        kickoff_time_utc = excluded.kickoff_time_utc,
        match_status = excluded.match_status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        extra_time_score = excluded.extra_time_score,
        penalty_score = excluded.penalty_score,
        home_winner = excluded.home_winner,
        away_winner = excluded.away_winner,
        result_source = excluded.result_source,
        result_updated_at = excluded.result_updated_at,
        last_result_check_at = excluded.last_result_check_at,
        result_sync_error = excluded.result_sync_error,
        post_match_analysis_status = excluded.post_match_analysis_status`,
      [
        local.id,
        String(externalId),
        new Date(fixture.date).toISOString(),
        status,
        integerOrNull(goals.home),
        integerOrNull(goals.away),
        scorePair(score.extratime),
        scorePair(score.penalty),
        winnerFlag(teams.home?.winner),
        winnerFlag(teams.away?.winner),
        "api-football",
        now,
        now,
        null,
        analysisStatus(status, goals)
      ]
    );

    if (isFinishedStatus(status) && goals.home != null && goals.away != null) {
      finished += 1;
      db.run(
        `INSERT INTO overrides (match_id, home_score, away_score, note, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(match_id) DO UPDATE SET
           home_score = excluded.home_score,
           away_score = excluded.away_score,
           note = excluded.note,
           updated_at = excluded.updated_at`,
        [
          local.id,
          Number(goals.home),
          Number(goals.away),
          `${AUTO_NOTE_PREFIX}: api-football fixture ${externalId}, ${local.home} ${goals.home}-${goals.away} ${local.away}`,
          now
        ]
      );
      overridesWritten += 1;
    }
  }
  return { apiRows: apiRows.length, apiRowsSaved, matched, unmatched: failures, finished, overridesWritten, requestsUsed: 1 };
}

function matchLocalFixture(localFixtures, apiRow) {
  const home = normalizeName(apiRow.teams?.home?.name ?? "");
  const away = normalizeName(apiRow.teams?.away?.name ?? "");
  const kickoff = new Date(apiRow.fixture?.date ?? 0).getTime();
  const candidates = localFixtures.filter((fixture) => {
    const sameTeams = normalizeName(fixture.home) === home && normalizeName(fixture.away) === away;
    const delta = Math.abs(new Date(fixture.sortDate).getTime() - kickoff);
    return sameTeams && delta <= 12 * 60 * 60 * 1000;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function mapStatus(shortStatus) {
  const value = String(shortStatus ?? "").toUpperCase();
  if (value === "NS" || value === "TBD") return "scheduled";
  if (value === "1H" || value === "2H" || value === "ET" || value === "BT") return "in_progress";
  if (value === "HT") return "halftime";
  if (value === "P") return "penalty_shootout";
  if (value === "FT") return "finished";
  if (value === "AET") return "finished_after_extra_time";
  if (value === "PEN") return "finished_after_penalties";
  if (value === "PST") return "postponed";
  if (value === "CANC") return "cancelled";
  if (value === "ABD") return "abandoned";
  if (value === "AWD") return "awarded";
  if (value === "WO") return "walkover";
  return "scheduled";
}

function isFinishedStatus(status) {
  return ["finished", "finished_after_extra_time", "finished_after_penalties", "awarded", "walkover"].includes(status);
}

export function analysisStatus(status, goals = {}) {
  if (goals.home == null || goals.away == null) return "pending";
  if (["finished", "finished_after_extra_time", "finished_after_penalties"].includes(status)) return "completed";
  if (["awarded", "walkover"].includes(status)) return "special";
  return "pending";
}

function scorePair(value) {
  if (!value || value.home == null || value.away == null) return null;
  return `${value.home}-${value.away}`;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? Number(value) : null;
}

function winnerFlag(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function normalizeName(name) {
  const normalized = String(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  const aliases = {
    "united states": "usa",
    "united states of america": "usa",
    "congo dr": "dr congo",
    "bosnia herzegovina": "bosnia and herzegovina",
    "bosnia and herzegovina": "bosnia and herzegovina",
    "cabo verde": "cape verde"
  };
  return aliases[normalized] ?? normalized;
}

function persist(db) {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
}

function maskState(state) {
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
