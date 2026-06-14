import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "generated-data.json");
const SUPPLEMENTAL_RESULTS_PATH = path.join(ROOT, "src", "data", "result-supplements.json");
const DB_DIR = path.join(ROOT, ".local");
const DB_PATH = path.join(DB_DIR, "worldcup.sqlite");
const WORLD_CUP_2026_URL = "https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt";
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
  const generated = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const fixtures = generated.fixtures ?? [];
  const text = await fetchText(WORLD_CUP_2026_URL);
  const scored = parseOpenfootballResults(text);
  const matched = matchScoredFixtures(scored, fixtures);
  const supplemental = readSupplementalResults(fixtures);
  const combined = mergeResults([...matched, ...supplemental]);
  const summary = await upsertAutoResults(combined);
  console.log(
    JSON.stringify(
      {
        source: WORLD_CUP_2026_URL,
        scoredFound: scored.length,
        matched: matched.length,
        supplemental: supplemental.length,
        combined: combined.length,
        insertedOrUpdated: summary.insertedOrUpdated,
        preservedManual: summary.preservedManual,
        unmatched: scored.filter((row) => !matched.some((item) => item.home === row.home && item.away === row.away)).map((row) => `${row.home} ${row.homeScore}-${row.awayScore} ${row.away}`)
      },
      null,
      2
    )
  );
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
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

function mergeResults(results) {
  const byMatchId = new Map();
  for (const result of results) {
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
