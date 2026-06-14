import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { data } from "@/lib/data";
import { readNightlySnapshotOdds } from "@/lib/nightly-snapshot";
import type { OddsQuote, OverrideResult, TeamInput } from "@/lib/types";

const dbDir = process.env.WORLD_CUP_DATA_DIR ?? (process.env.VERCEL ? path.join("/tmp", "world-cup-predictor") : path.join(process.cwd(), ".local"));
const dbPath = path.join(dbDir, "worldcup.sqlite");
const resultsRefreshPath = path.join(dbDir, "results-refresh.json");
const resultSupplementsPath = path.join(process.cwd(), "src", "data", "result-supplements.json");
const resultsRefreshIntervalMs = 15 * 60 * 1000;
const worldCup2026ResultsUrl = "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt";
const autoResultNotePrefix = "自动抓取赛果";

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });
  return sqlPromise;
}

async function openDb(): Promise<Database> {
  fs.mkdirSync(dbDir, { recursive: true });
  const SQL = await getSql();
  const db = fs.existsSync(dbPath) ? new SQL.Database(new Uint8Array(fs.readFileSync(dbPath))) : new SQL.Database();
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
    CREATE TABLE IF NOT EXISTS odds_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      home_price REAL NOT NULL,
      draw_price REAL NOT NULL,
      away_price REAL NOT NULL,
      quote_type TEXT NOT NULL DEFAULT 'current',
      market_kind TEXT NOT NULL DEFAULT 'sportsbook',
      fetched_at TEXT NOT NULL,
      source_url TEXT NOT NULL
    );
  `);
  ensureColumn(db, "odds_quotes", "quote_type", "TEXT NOT NULL DEFAULT 'current'");
  ensureColumn(db, "odds_quotes", "market_kind", "TEXT NOT NULL DEFAULT 'sportsbook'");
  db.run(`
    CREATE TABLE IF NOT EXISTS team_inputs (
      team_name TEXT PRIMARY KEY,
      fifa_rank INTEGER,
      market_value_eur_m REAL,
      projected_xi_value_eur_m REAL,
      injuries INTEGER NOT NULL DEFAULT 0,
      suspensions INTEGER NOT NULL DEFAULT 0,
      key_absences INTEGER NOT NULL DEFAULT 0,
      lineup_checked_at TEXT,
      updated_at TEXT NOT NULL,
      source_url TEXT NOT NULL
    );
  `);
  ensureColumn(db, "team_inputs", "lineup_checked_at", "TEXT");
  return db;
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const columns = new Set((info[0]?.values ?? []).map((row) => String(row[1])));
  if (!columns.has(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function persist(db: Database): void {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

export async function readOverrides(): Promise<OverrideResult[]> {
  if (process.env.VERCEL) return [];
  await refreshAutoResultsIfStale().catch(() => undefined);
  const db = await openDb();
  const result = db.exec("SELECT match_id, home_score, away_score, note, updated_at FROM overrides ORDER BY updated_at DESC");
  db.close();
  return (result[0]?.values ?? []).map((row) => ({
    matchId: String(row[0]),
    homeScore: Number(row[1]),
    awayScore: Number(row[2]),
    note: row[3] == null ? null : String(row[3]),
    updatedAt: String(row[4])
  }));
}

async function refreshAutoResultsIfStale(): Promise<void> {
  if (!shouldRefreshResults()) return;
  fs.mkdirSync(dbDir, { recursive: true });
  writeResultsRefreshState({ lastAttemptAt: new Date().toISOString(), status: "running" });
  try {
    const response = await fetch(worldCup2026ResultsUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const scored = parseOpenfootballResults(await response.text());
    const matched = matchScoredFixtures(scored);
    const supplemental = readSupplementalResults();
    const combined = mergeAutoResults([...matched, ...supplemental]);
    const summary = await upsertAutoResults(combined);
    writeResultsRefreshState({
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      status: "ok",
      scoredFound: scored.length,
      matched: matched.length,
      supplemental: supplemental.length,
      combined: combined.length,
      insertedOrUpdated: summary.insertedOrUpdated,
      preservedManual: summary.preservedManual
    });
  } catch (error) {
    writeResultsRefreshState({
      lastAttemptAt: new Date().toISOString(),
      status: "error",
      error: error instanceof Error ? error.message : "unknown"
    });
  }
}

function shouldRefreshResults(): boolean {
  try {
    if (!fs.existsSync(resultsRefreshPath)) return true;
    const state = JSON.parse(fs.readFileSync(resultsRefreshPath, "utf8")) as { lastAttemptAt?: string };
    const lastAttempt = state.lastAttemptAt ? new Date(state.lastAttemptAt).getTime() : 0;
    return !Number.isFinite(lastAttempt) || Date.now() - lastAttempt > resultsRefreshIntervalMs;
  } catch {
    return true;
  }
}

function writeResultsRefreshState(state: Record<string, unknown>): void {
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(resultsRefreshPath, JSON.stringify(state, null, 2));
}

function parseOpenfootballResults(text: string): Array<{ group: string; home: string; away: string; homeScore: number; awayScore: number }> {
  const rows: Array<{ group: string; home: string; away: string; homeScore: number; awayScore: number }> = [];
  let currentGroup: string | null = null;
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
      home: match[1].replace(/\s+/g, " ").trim(),
      away: match[4].replace(/\s+/g, " ").trim(),
      homeScore: Number(match[2]),
      awayScore: Number(match[3])
    });
  }
  return rows;
}

function matchScoredFixtures(scored: Array<{ home: string; away: string; homeScore: number; awayScore: number }>): OverrideResult[] {
  return scored.flatMap((result) => {
    const fixture = data.fixtures.find(
      (match) => normalizeResultTeam(match.home) === normalizeResultTeam(result.home) && normalizeResultTeam(match.away) === normalizeResultTeam(result.away)
    );
    if (!fixture) return [];
    return [
      {
        matchId: fixture.id,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        note: `${autoResultNotePrefix}：openfootball/worldcup 2026，${fixture.home} ${result.homeScore}-${result.awayScore} ${fixture.away}`,
        updatedAt: new Date().toISOString()
      }
    ];
  });
}

function readSupplementalResults(): OverrideResult[] {
  if (!fs.existsSync(resultSupplementsPath)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(resultSupplementsPath, "utf8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const fixture = data.fixtures.find(
        (match) =>
          match.id === row.matchId ||
          (normalizeResultTeam(match.home) === normalizeResultTeam(String(row.home ?? "")) &&
            normalizeResultTeam(match.away) === normalizeResultTeam(String(row.away ?? "")))
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
          homeScore,
          awayScore,
          note: `${autoResultNotePrefix}: ${sourceName}, ${fixture.home} ${homeScore}-${awayScore} ${fixture.away}, ${sourceUrl}`,
          updatedAt: new Date().toISOString()
        }
      ];
    });
  } catch {
    return [];
  }
}

function mergeAutoResults(results: OverrideResult[]): OverrideResult[] {
  const byMatchId = new Map<string, OverrideResult>();
  for (const result of results) {
    byMatchId.set(result.matchId, result);
  }
  return [...byMatchId.values()];
}

async function upsertAutoResults(results: OverrideResult[]): Promise<{ insertedOrUpdated: number; preservedManual: number }> {
  if (!results.length) return { insertedOrUpdated: 0, preservedManual: 0 };
  const db = await openDb();
  let insertedOrUpdated = 0;
  let preservedManual = 0;
  for (const result of results) {
    const current = db.exec("SELECT note FROM overrides WHERE match_id = ?", [result.matchId])[0]?.values?.[0];
    const note = current?.[0] == null ? null : String(current[0]);
    if (note && !note.startsWith(autoResultNotePrefix)) {
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
      [result.matchId, result.homeScore, result.awayScore, result.note, result.updatedAt]
    );
    insertedOrUpdated += 1;
  }
  persist(db);
  return { insertedOrUpdated, preservedManual };
}

function normalizeResultTeam(name: string): string {
  const normalized = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  const aliases: Record<string, string> = {
    "united states": "usa",
    "united states of america": "usa",
    "korea republic": "south korea",
    czechia: "czech republic",
    turkiye: "turkey",
    "ir iran": "iran",
    "cote d ivoire": "ivory coast",
    "congo dr": "dr congo",
    "democratic republic of the congo": "dr congo",
    "cabo verde": "cape verde",
    curacao: "curacao",
    "bosnia and herzegovina": "bosnia and herzegovina",
    "bosnia herzegovina": "bosnia and herzegovina"
  };
  return aliases[normalized] ?? normalized;
}

export async function saveOverride(input: { matchId: string; homeScore: number; awayScore: number; note?: string | null }): Promise<void> {
  const db = await openDb();
  db.run(
    `INSERT INTO overrides (match_id, home_score, away_score, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       home_score = excluded.home_score,
       away_score = excluded.away_score,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [input.matchId, input.homeScore, input.awayScore, input.note ?? null, new Date().toISOString()]
  );
  persist(db);
}

export async function deleteOverride(matchId: string): Promise<void> {
  const db = await openDb();
  db.run("DELETE FROM overrides WHERE match_id = ?", [matchId]);
  persist(db);
}

export async function readOdds(): Promise<OddsQuote[]> {
  if (process.env.VERCEL) return readNightlySnapshotOdds();
  const db = await openDb();
  const result = db.exec(
    "SELECT match_id, provider, home_price, draw_price, away_price, quote_type, market_kind, fetched_at, source_url FROM odds_quotes ORDER BY fetched_at DESC"
  );
  db.close();
  const dbOdds = (result[0]?.values ?? []).map((row) => ({
    matchId: String(row[0]),
    provider: String(row[1]),
    homePrice: Number(row[2]),
    drawPrice: Number(row[3]),
    awayPrice: Number(row[4]),
    quoteType: normalizeQuoteType(row[5]),
    marketKind: normalizeMarketKind(row[6]),
    fetchedAt: String(row[7]),
    sourceUrl: String(row[8])
  }));
  return [...dbOdds, ...readNightlySnapshotOdds()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

export async function insertOdds(quotes: OddsQuote[]): Promise<number> {
  if (!quotes.length) return 0;
  const db = await openDb();
  for (const quote of quotes) {
    db.run(
      `INSERT INTO odds_quotes (match_id, provider, home_price, draw_price, away_price, quote_type, market_kind, fetched_at, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quote.matchId,
        quote.provider,
        quote.homePrice,
        quote.drawPrice,
        quote.awayPrice,
        quote.quoteType,
        quote.marketKind,
        quote.fetchedAt,
        quote.sourceUrl
      ]
    );
  }
  persist(db);
  return quotes.length;
}

export async function clearOdds(): Promise<void> {
  const db = await openDb();
  db.run("DELETE FROM odds_quotes");
  persist(db);
}

export async function readTeamInputs(): Promise<TeamInput[]> {
  if (process.env.VERCEL) {
    return data.teams.map((team) => ({
      teamName: team.name,
      fifaRank: team.fifaRank,
      marketValueEurM: team.marketValueEurM,
      projectedXIValueEurM: null,
      injuries: 0,
      suspensions: 0,
      keyAbsences: 0,
      lineupCheckedAt: null,
      updatedAt: data.generatedAt,
      sourceUrl: "src/data/generated-data.json"
    }));
  }
  const db = await openDb();
  const result = db.exec(
    `SELECT team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m,
            injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url
     FROM team_inputs
     ORDER BY updated_at DESC`
  );
  db.close();
  return (result[0]?.values ?? []).map((row) => ({
    teamName: String(row[0]),
    fifaRank: row[1] == null ? null : Number(row[1]),
    marketValueEurM: row[2] == null ? null : Number(row[2]),
    projectedXIValueEurM: row[3] == null ? null : Number(row[3]),
    injuries: Number(row[4]),
    suspensions: Number(row[5]),
    keyAbsences: Number(row[6]),
    lineupCheckedAt: row[7] == null ? null : String(row[7]),
    updatedAt: String(row[8]),
    sourceUrl: String(row[9])
  }));
}

export async function upsertTeamInputs(inputs: TeamInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const db = await openDb();
  for (const input of inputs) {
    db.run(
      `INSERT INTO team_inputs (
         team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m,
         injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_name) DO UPDATE SET
         fifa_rank = excluded.fifa_rank,
         market_value_eur_m = excluded.market_value_eur_m,
         projected_xi_value_eur_m = excluded.projected_xi_value_eur_m,
         injuries = excluded.injuries,
         suspensions = excluded.suspensions,
         key_absences = excluded.key_absences,
         lineup_checked_at = excluded.lineup_checked_at,
         updated_at = excluded.updated_at,
         source_url = excluded.source_url`,
      [
        input.teamName,
        input.fifaRank,
        input.marketValueEurM,
        input.projectedXIValueEurM,
        input.injuries,
        input.suspensions,
        input.keyAbsences,
        input.lineupCheckedAt,
        input.updatedAt,
        input.sourceUrl
      ]
    );
  }
  persist(db);
  return inputs.length;
}

function normalizeQuoteType(value: unknown): OddsQuote["quoteType"] {
  if (value === "opening" || value === "closing") return value;
  return "current";
}

function normalizeMarketKind(value: unknown): OddsQuote["marketKind"] {
  return value === "prediction_market" ? "prediction_market" : "sportsbook";
}
