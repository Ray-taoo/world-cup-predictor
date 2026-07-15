import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { getD1 } from "@/lib/cloudflare";
import { data } from "@/lib/data";
import { readNightlySnapshotOdds } from "@/lib/nightly-snapshot";
import type { OddsQuote, OverrideResult, TeamInput } from "@/lib/types";

const dbDir = process.env.WORLD_CUP_DATA_DIR ?? (process.env.VERCEL ? path.join("/tmp", "world-cup-predictor") : path.join(process.cwd(), ".local"));
const dbPath = path.join(dbDir, "worldcup.sqlite");
const worldcupSyncDbPath = path.join(dbDir, "worldcup-sync.sqlite");
const resultsRefreshPath = path.join(dbDir, "results-refresh.json");
const resultSupplementsPath = path.join(process.cwd(), "src", "data", "result-supplements.json");
const nightlySnapshotPath = path.join(process.cwd(), "src", "data", "nightly-snapshot.json");
const resultsRefreshIntervalMs = 15 * 60 * 1000;
const worldCup2026ResultsUrl = "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt";
const autoResultNotePrefix = "自动抓取赛果";

let sqlPromise: Promise<SqlJsStatic> | null = null;
let overridesCache: { revision: string; value: OverrideResult[] } | null = null;
let oddsCache: { revision: string; value: OddsQuote[] } | null = null;
let teamInputsCache: { revision: string; value: TeamInput[] } | null = null;

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
      external_event_id TEXT,
      provider TEXT NOT NULL,
      home_price REAL NOT NULL,
      draw_price REAL NOT NULL,
      away_price REAL NOT NULL,
      total_line REAL,
      over_price REAL,
      under_price REAL,
      handicap_line REAL,
      home_handicap_price REAL,
      away_handicap_price REAL,
      btts_yes_price REAL,
      btts_no_price REAL,
      quote_type TEXT NOT NULL DEFAULT 'current',
      market_kind TEXT NOT NULL DEFAULT 'sportsbook',
      fetched_at TEXT NOT NULL,
      source_url TEXT NOT NULL
    );
  `);
  ensureColumn(db, "odds_quotes", "quote_type", "TEXT NOT NULL DEFAULT 'current'");
  ensureColumn(db, "odds_quotes", "external_event_id", "TEXT");
  ensureColumn(db, "odds_quotes", "market_kind", "TEXT NOT NULL DEFAULT 'sportsbook'");
  ensureColumn(db, "odds_quotes", "total_line", "REAL");
  ensureColumn(db, "odds_quotes", "over_price", "REAL");
  ensureColumn(db, "odds_quotes", "under_price", "REAL");
  ensureColumn(db, "odds_quotes", "handicap_line", "REAL");
  ensureColumn(db, "odds_quotes", "home_handicap_price", "REAL");
  ensureColumn(db, "odds_quotes", "away_handicap_price", "REAL");
  ensureColumn(db, "odds_quotes", "btts_yes_price", "REAL");
  ensureColumn(db, "odds_quotes", "btts_no_price", "REAL");
  db.run("CREATE INDEX IF NOT EXISTS idx_odds_quotes_read ON odds_quotes(match_id, provider, quote_type, fetched_at, id)");
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
  const d1 = await getD1();
  if (d1) {
    const { results } = await d1.prepare(`SELECT o.match_id, o.home_score, o.away_score, o.note, o.updated_at,
      s.normal_time_home_score, s.normal_time_away_score
      FROM overrides o LEFT JOIN result_sync_status s ON s.match_id = o.match_id ORDER BY o.updated_at DESC`).bind().all<Record<string, unknown>>();
    return results.map((row) => ({
      matchId: String(row.match_id), homeScore: Number(row.home_score), awayScore: Number(row.away_score),
      note: row.note == null ? null : String(row.note), updatedAt: String(row.updated_at),
      normalTimeHomeScore: nullableNumber(row.normal_time_home_score) ?? undefined,
      normalTimeAwayScore: nullableNumber(row.normal_time_away_score) ?? undefined
    }));
  }
  if (process.env.VERCEL) return [];
  await refreshAutoResultsIfStale().catch(() => undefined);
  const revision = fileRevision(dbPath, worldcupSyncDbPath);
  if (overridesCache?.revision === revision) return overridesCache.value;
  const db = await openDb();
  const statusColumns = new Set((db.exec("PRAGMA table_info(result_sync_status)")[0]?.values ?? []).map((row) => String(row[1])));
  const result = db.exec(statusColumns.has("normal_time_home_score") && statusColumns.has("normal_time_away_score")
    ? `SELECT o.match_id, o.home_score, o.away_score, o.note, o.updated_at,
              s.normal_time_home_score, s.normal_time_away_score
       FROM overrides o
       LEFT JOIN result_sync_status s ON s.match_id = o.match_id
       ORDER BY o.updated_at DESC`
    : "SELECT match_id, home_score, away_score, note, updated_at, NULL, NULL FROM overrides ORDER BY updated_at DESC");
  db.close();
  const overrides = (result[0]?.values ?? []).map((row) => ({
    matchId: String(row[0]),
    homeScore: Number(row[1]),
    awayScore: Number(row[2]),
    note: row[3] == null ? null : String(row[3]),
    updatedAt: String(row[4]),
    normalTimeHomeScore: row[5] == null ? undefined : Number(row[5]),
    normalTimeAwayScore: row[6] == null ? undefined : Number(row[6])
  }));
  const value = mergeOverrides(overrides, await readWorldcupSyncOverrides());
  overridesCache = { revision, value };
  return value;
}

async function readWorldcupSyncOverrides(): Promise<OverrideResult[]> {
  if (!fs.existsSync(worldcupSyncDbPath)) return [];
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(worldcupSyncDbPath)));
  try {
    const rows = db.exec(`
      SELECT local_match_id, home_score, away_score, external_provider, external_event_id, updated_at
      FROM matches
      WHERE status = 'completed'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND local_match_id LIKE 'M%'
      ORDER BY updated_at DESC
    `)[0]?.values ?? [];
    return rows.map((row) => ({
      matchId: String(row[0]),
      homeScore: Number(row[1]),
      awayScore: Number(row[2]),
      note: `${autoResultNotePrefix}: ${String(row[3])} event ${String(row[4])}`,
      updatedAt: String(row[5])
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function mergeOverrides(primary: OverrideResult[], secondary: OverrideResult[]): OverrideResult[] {
  const byMatch = new Map<string, OverrideResult>();
  for (const row of secondary) byMatch.set(row.matchId, row);
  for (const row of primary) byMatch.set(row.matchId, row);
  return [...byMatch.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function refreshAutoResultsIfStale(): Promise<void> {
  if (process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (!shouldRefreshResults()) return;
  const syncResult = runWorldcupRecentSync();
  const syncPayload = parseSyncOutput(syncResult.stdout);
  if (syncResult.status === 0 && syncPayload && Number(syncPayload.events) > 0) {
    writeResultsRefreshState({
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      status: "ok",
      source: syncPayload.source ?? "sofascore",
      events: syncPayload.events,
      upserted: syncPayload.upserted,
      completed: syncPayload.completed
    });
    return;
  }

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

function runWorldcupRecentSync(): ReturnType<typeof spawnSync> {
  const args = ["workers/worldcup-sync/src/entry.py", "recent", "--db", worldcupSyncDbPath];
  const candidates = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  let last = spawnSync(candidates[0], args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", timeout: 45000 });
  if (last.error && candidates.length > 1) {
    last = spawnSync(candidates[1], args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", timeout: 45000 });
  }
  return last;
}

function parseSyncOutput(value: string | Buffer | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
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
  const d1 = await getD1();
  if (d1) {
    await d1.prepare(`INSERT INTO overrides (match_id, home_score, away_score, note, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score, away_score=excluded.away_score, note=excluded.note, updated_at=excluded.updated_at`)
      .bind(input.matchId, input.homeScore, input.awayScore, input.note ?? null, new Date().toISOString()).run();
    return;
  }
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
  const d1 = await getD1();
  if (d1) {
    await d1.prepare("DELETE FROM overrides WHERE match_id = ?").bind(matchId).run();
    return;
  }
  const db = await openDb();
  db.run("DELETE FROM overrides WHERE match_id = ?", [matchId]);
  persist(db);
}

export async function readOdds(): Promise<OddsQuote[]> {
  const d1 = await getD1();
  if (d1) {
    const { results } = await d1.prepare(`WITH current AS (
      SELECT id, match_id, provider, ROW_NUMBER() OVER (PARTITION BY match_id, provider ORDER BY fetched_at DESC, id DESC) AS rn
      FROM odds_quotes WHERE quote_type != 'opening'
    ), selected_current AS (
      SELECT id, match_id FROM current WHERE rn = 1
    ), opening AS (
      SELECT id, match_id, ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY fetched_at DESC, id DESC) AS rn
      FROM odds_quotes WHERE quote_type = 'opening'
    ), selected AS (
      SELECT id FROM selected_current
      UNION ALL
      SELECT id FROM opening WHERE rn = 1 AND NOT EXISTS (SELECT 1 FROM selected_current WHERE selected_current.match_id = opening.match_id)
    ) SELECT match_id, external_event_id, provider, home_price, draw_price, away_price, total_line, over_price, under_price,
      handicap_line, home_handicap_price, away_handicap_price, btts_yes_price, btts_no_price, quote_type, market_kind, fetched_at, source_url
      FROM odds_quotes WHERE id IN (SELECT id FROM selected) ORDER BY fetched_at DESC`).bind().all<Record<string, unknown>>();
    return results.map(d1OddsRow);
  }
  if (process.env.VERCEL) return readNightlySnapshotOdds();
  const revision = fileRevision(dbPath, nightlySnapshotPath);
  if (oddsCache?.revision === revision) return oddsCache.value;
  const db = await openDb();
  const result = db.exec(
    `WITH opening AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY match_id, provider ORDER BY fetched_at ASC, id ASC) AS rn
       FROM odds_quotes WHERE quote_type = 'opening'
     ), recent AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY match_id, provider ORDER BY fetched_at DESC, id DESC) AS rn
       FROM odds_quotes WHERE quote_type != 'opening'
     )
     SELECT match_id, external_event_id, provider, home_price, draw_price, away_price,
            total_line, over_price, under_price, handicap_line, home_handicap_price, away_handicap_price,
            btts_yes_price, btts_no_price, quote_type, market_kind, fetched_at, source_url
     FROM odds_quotes
     WHERE id IN (
       SELECT id FROM opening WHERE rn = 1
       UNION
       SELECT id FROM recent WHERE rn <= 2
     )
     ORDER BY fetched_at DESC`
  );
  db.close();
  const dbOdds = (result[0]?.values ?? []).map((row) => ({
    matchId: String(row[0]),
    externalEventId: row[1] == null ? null : String(row[1]),
    provider: String(row[2]),
    homePrice: Number(row[3]),
    drawPrice: Number(row[4]),
    awayPrice: Number(row[5]),
    totalLine: nullableNumber(row[6]),
    overPrice: nullableNumber(row[7]),
    underPrice: nullableNumber(row[8]),
    handicapLine: nullableNumber(row[9]),
    homeHandicapPrice: nullableNumber(row[10]),
    awayHandicapPrice: nullableNumber(row[11]),
    bttsYesPrice: nullableNumber(row[12]),
    bttsNoPrice: nullableNumber(row[13]),
    quoteType: normalizeQuoteType(row[14]),
    marketKind: normalizeMarketKind(row[15]),
    fetchedAt: String(row[16]),
    sourceUrl: String(row[17])
  }));
  const value = [...dbOdds, ...readNightlySnapshotOdds()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  oddsCache = { revision, value };
  return value;
}

export async function insertOdds(quotes: OddsQuote[]): Promise<number> {
  if (!quotes.length) return 0;
  const d1 = await getD1();
  if (d1) {
    for (const quote of quotes) {
      await insertD1Quote(d1, quote);
      if (quote.quoteType !== "opening") {
        const existing = await d1.prepare("SELECT id FROM odds_quotes WHERE match_id=? AND provider=? AND quote_type='opening' LIMIT 1").bind(quote.matchId, quote.provider).first();
        if (!existing) await insertD1Quote(d1, { ...quote, quoteType: "opening", sourceUrl: `${quote.sourceUrl}#opening-baseline` });
      }
    }
    return quotes.length;
  }
  const db = await openDb();
  for (const quote of quotes) {
    db.run(
      `INSERT INTO odds_quotes (
         match_id, external_event_id, provider, home_price, draw_price, away_price,
         total_line, over_price, under_price,
         handicap_line, home_handicap_price, away_handicap_price,
         btts_yes_price, btts_no_price,
         quote_type, market_kind, fetched_at, source_url
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quote.matchId,
        quote.externalEventId ?? null,
        quote.provider,
        quote.homePrice,
        quote.drawPrice,
        quote.awayPrice,
        quote.totalLine ?? null,
        quote.overPrice ?? null,
        quote.underPrice ?? null,
        quote.handicapLine ?? null,
        quote.homeHandicapPrice ?? null,
        quote.awayHandicapPrice ?? null,
        quote.bttsYesPrice ?? null,
        quote.bttsNoPrice ?? null,
        quote.quoteType,
        quote.marketKind,
        quote.fetchedAt,
        quote.sourceUrl
      ]
    );
  }
  backfillOpeningOddsBaselines(db, [...new Set(quotes.map((quote) => quote.matchId))]);
  persist(db);
  return quotes.length;
}

function backfillOpeningOddsBaselines(db: Database, matchIds: string[]): void {
  for (const matchId of matchIds) {
    const providers = db.exec("SELECT DISTINCT provider FROM odds_quotes WHERE match_id = ?", [matchId])[0]?.values ?? [];
    for (const providerRow of providers) {
      const provider = String(providerRow[0]);
      const hasOpening = db.exec("SELECT 1 FROM odds_quotes WHERE match_id = ? AND provider = ? AND quote_type = 'opening' LIMIT 1", [matchId, provider])[0]?.values?.length;
      if (hasOpening) continue;

      const baseline = db.exec(
        `SELECT match_id, external_event_id, provider, home_price, draw_price, away_price,
                total_line, over_price, under_price,
                handicap_line, home_handicap_price, away_handicap_price,
                btts_yes_price, btts_no_price,
                market_kind, fetched_at, source_url
         FROM odds_quotes
         WHERE match_id = ? AND provider = ? AND quote_type != 'opening'
         ORDER BY fetched_at ASC
         LIMIT 1`,
        [matchId, provider]
      )[0]?.values?.[0];
      if (!baseline) continue;

      db.run(
        `INSERT INTO odds_quotes (
           match_id, external_event_id, provider, home_price, draw_price, away_price,
           total_line, over_price, under_price,
           handicap_line, home_handicap_price, away_handicap_price,
           btts_yes_price, btts_no_price,
           quote_type, market_kind, fetched_at, source_url
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opening', ?, ?, ?)`,
        [
          String(baseline[0]),
          baseline[1] == null ? null : String(baseline[1]),
          String(baseline[2]),
          Number(baseline[3]),
          Number(baseline[4]),
          Number(baseline[5]),
          nullableNumber(baseline[6]),
          nullableNumber(baseline[7]),
          nullableNumber(baseline[8]),
          nullableNumber(baseline[9]),
          nullableNumber(baseline[10]),
          nullableNumber(baseline[11]),
          nullableNumber(baseline[12]),
          nullableNumber(baseline[13]),
          String(baseline[14]),
          String(baseline[15]),
          `${String(baseline[16])}#local-opening-baseline`
        ]
      );
    }
  }
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function clearOdds(): Promise<void> {
  const d1 = await getD1();
  if (d1) {
    await d1.prepare("DELETE FROM odds_quotes").bind().run();
    return;
  }
  const db = await openDb();
  db.run("DELETE FROM odds_quotes");
  persist(db);
}

export async function readTeamInputs(): Promise<TeamInput[]> {
  const d1 = await getD1();
  if (d1) {
    const { results } = await d1.prepare(`SELECT team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m,
      injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url FROM team_inputs ORDER BY updated_at DESC`).bind().all<Record<string, unknown>>();
    return results.map((row) => ({
      teamName: String(row.team_name), fifaRank: nullableNumber(row.fifa_rank), marketValueEurM: nullableNumber(row.market_value_eur_m),
      projectedXIValueEurM: nullableNumber(row.projected_xi_value_eur_m), injuries: Number(row.injuries), suspensions: Number(row.suspensions),
      keyAbsences: Number(row.key_absences), lineupCheckedAt: row.lineup_checked_at == null ? null : String(row.lineup_checked_at),
      updatedAt: String(row.updated_at), sourceUrl: String(row.source_url)
    }));
  }
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
  const revision = fileRevision(dbPath);
  if (teamInputsCache?.revision === revision) return teamInputsCache.value;
  const db = await openDb();
  const result = db.exec(
    `SELECT team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m,
            injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url
     FROM team_inputs
     ORDER BY updated_at DESC`
  );
  db.close();
  const value = (result[0]?.values ?? []).map((row) => ({
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
  teamInputsCache = { revision, value };
  return value;
}

function fileRevision(...files: string[]): string {
  return files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "missing";
    }
  }).join("|");
}

export async function upsertTeamInputs(inputs: TeamInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const d1 = await getD1();
  if (d1) {
    for (const input of inputs) {
      await d1.prepare(`INSERT INTO team_inputs (team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m, injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(team_name) DO UPDATE SET fifa_rank=excluded.fifa_rank, market_value_eur_m=excluded.market_value_eur_m,
        projected_xi_value_eur_m=excluded.projected_xi_value_eur_m, injuries=excluded.injuries, suspensions=excluded.suspensions, key_absences=excluded.key_absences,
        lineup_checked_at=excluded.lineup_checked_at, updated_at=excluded.updated_at, source_url=excluded.source_url`)
        .bind(input.teamName, input.fifaRank, input.marketValueEurM, input.projectedXIValueEurM, input.injuries, input.suspensions, input.keyAbsences, input.lineupCheckedAt, input.updatedAt, input.sourceUrl).run();
    }
    return inputs.length;
  }
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
  if (value === "smart_wallet") return "smart_wallet";
  return value === "prediction_market" ? "prediction_market" : "sportsbook";
}

function d1OddsRow(row: Record<string, unknown>): OddsQuote {
  return {
    matchId: String(row.match_id), externalEventId: row.external_event_id == null ? null : String(row.external_event_id), provider: String(row.provider),
    homePrice: Number(row.home_price), drawPrice: Number(row.draw_price), awayPrice: Number(row.away_price), totalLine: nullableNumber(row.total_line),
    overPrice: nullableNumber(row.over_price), underPrice: nullableNumber(row.under_price), handicapLine: nullableNumber(row.handicap_line),
    homeHandicapPrice: nullableNumber(row.home_handicap_price), awayHandicapPrice: nullableNumber(row.away_handicap_price), bttsYesPrice: nullableNumber(row.btts_yes_price),
    bttsNoPrice: nullableNumber(row.btts_no_price), quoteType: normalizeQuoteType(row.quote_type), marketKind: normalizeMarketKind(row.market_kind),
    fetchedAt: String(row.fetched_at), sourceUrl: String(row.source_url)
  };
}

async function insertD1Quote(d1: NonNullable<Awaited<ReturnType<typeof getD1>>>, quote: OddsQuote): Promise<void> {
  const values = [quote.matchId, quote.externalEventId ?? null, quote.provider, quote.homePrice, quote.drawPrice, quote.awayPrice, quote.totalLine ?? null, quote.overPrice ?? null,
    quote.underPrice ?? null, quote.handicapLine ?? null, quote.homeHandicapPrice ?? null, quote.awayHandicapPrice ?? null, quote.bttsYesPrice ?? null, quote.bttsNoPrice ?? null,
    quote.quoteType, quote.marketKind, quote.fetchedAt, quote.sourceUrl];
  const dedupeKey = JSON.stringify(values);
  await d1.prepare(`INSERT OR IGNORE INTO odds_quotes (dedupe_key, match_id, external_event_id, provider, home_price, draw_price, away_price, total_line, over_price, under_price,
    handicap_line, home_handicap_price, away_handicap_price, btts_yes_price, btts_no_price, quote_type, market_kind, fetched_at, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(dedupeKey, ...values).run();
}
