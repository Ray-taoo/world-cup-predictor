import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "generated-data.json");
const DB_DIR = path.join(ROOT, ".local");
const DB_PATH = path.join(DB_DIR, "worldcup.sqlite");
const FIFA_RANKING_PAGE = "https://inside.fifa.com/en/fifa-world-ranking/men";
const FIFA_RANKING_API = "https://inside.fifa.com/api/ranking-overview";
const FIFA_LIVE_RANKING_API = "https://inside.fifa.com/api/live-world-ranking/get-rankings";
const TRANSFERMARKT_VALUES_URL = "https://www.transfermarkt.us/marktwertetop/wertvollstenationalmannschaften";

const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "accept-language": "en-US,en;q=0.9"
};

const aliases = new Map(
  Object.entries({
    "united states": "usa",
    "united states of america": "usa",
    "usa": "usa",
    "korea republic": "south korea",
    "south korea": "south korea",
    "czechia": "czech republic",
    "czech republic": "czech republic",
    "turkiye": "turkey",
    "türkiye": "turkey",
    "turkey": "turkey",
    "ir iran": "iran",
    "iran": "iran",
    "cote d ivoire": "ivory coast",
    "côte d'ivoire": "ivory coast",
    "ivory coast": "ivory coast",
    "congo dr": "dr congo",
    "dr congo": "dr congo",
    "democratic republic of the congo": "dr congo",
    "cabo verde": "cape verde",
    "cape verde": "cape verde",
    "curacao": "curaçao",
    "curaçao": "curaçao",
    "bosnia and herzergovina": "bosnia & herzegovina",
    "bosnia and herzegovina": "bosnia & herzegovina",
    "bosnia herzegovina": "bosnia & herzegovina",
    "bosnia & herzegovina": "bosnia & herzegovina"
  })
);

async function main() {
  const generated = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const teams = generated.teams.map((team) => team.name);
  const [rankings, marketValues] = await Promise.all([fetchFifaRankings(), fetchTransfermarktValues()]);
  const now = new Date().toISOString();
  const inputs = teams.map((team) => {
    const key = normalizeName(team);
    return {
      teamName: team,
      fifaRank: rankings.byName.get(key)?.rank ?? null,
      marketValueEurM: marketValues.byName.get(key)?.marketValueEurM ?? null,
      projectedXIValueEurM: null,
      injuries: 0,
      suspensions: 0,
      keyAbsences: 0,
      lineupCheckedAt: null,
      updatedAt: now,
      sourceUrl: `FIFA ${rankings.date}: ${rankings.sourceUrl} | Transfermarkt: ${marketValues.sourceUrl}`
    };
  });

  const summary = await upsertTeamInputs(inputs);
  console.log(JSON.stringify({
    teams: teams.length,
    fifaDate: rankings.date,
    fifaMatched: inputs.filter((row) => row.fifaRank != null).length,
    transfermarktMatched: inputs.filter((row) => row.marketValueEurM != null).length,
    insertedOrUpdated: summary,
    missingFifa: inputs.filter((row) => row.fifaRank == null).map((row) => row.teamName),
    missingTransfermarkt: inputs.filter((row) => row.marketValueEurM == null).map((row) => row.teamName)
  }, null, 2));
}

async function fetchFifaRankings() {
  const html = await fetchText(FIFA_RANKING_PAGE);
  const pageData = parseFifaPageData(html);
  const liveRankings = await fetchFifaLiveRankings(pageData);
  if (liveRankings.byName.size) return liveRankings;

  const dates = (pageData?.props?.pageProps?.pageData?.ranking?.allAvailableDates ?? [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (!dates.length) throw new Error("FIFA ranking page did not expose ranking dates.");

  for (const item of dates.slice(0, 20)) {
    const url = new URL(FIFA_RANKING_API);
    url.searchParams.set("locale", "en");
    url.searchParams.set("dateId", item.id);
    url.searchParams.set("gender", "men");
    const response = await fetch(url, { headers: { ...headers, accept: "application/json" } });
    if (!response.ok) continue;
    const body = await response.json();
    const rankings = Array.isArray(body.rankings) ? body.rankings : [];
    if (!rankings.length) continue;
    const byName = new Map();
    for (const row of rankings) {
      const rankingItem = row.rankingItem ?? {};
      const name = rankingItem.name;
      const rank = Number(rankingItem.rank);
      if (name && Number.isFinite(rank)) byName.set(normalizeName(name), { rank, name });
    }
    return {
      byName,
      date: item.date,
      sourceUrl: `${FIFA_RANKING_PAGE}?dateId=${item.id}`
    };
  }

  throw new Error("No non-empty FIFA ranking endpoint found in the latest available dates.");
}

function parseFifaPageData(html) {
  const dataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!dataMatch) throw new Error("FIFA ranking page did not include __NEXT_DATA__.");
  return JSON.parse(dataMatch[1]);
}

async function fetchFifaLiveRankings(pageData) {
  const url = new URL(FIFA_LIVE_RANKING_API);
  url.searchParams.set("mode", "live");
  url.searchParams.set("gender", "1");
  url.searchParams.set("locale", "en");
  url.searchParams.set("count", "250");
  url.searchParams.set("rankingType", "football");

  const response = await fetch(url, {
    headers: {
      ...headers,
      accept: "application/json",
      referer: FIFA_RANKING_PAGE
    }
  });
  if (!response.ok) return { byName: new Map(), date: "unknown", sourceUrl: FIFA_RANKING_PAGE };

  const body = await response.json();
  const rankings = Array.isArray(body.rankings) ? body.rankings : [];
  const byName = new Map();
  let latestUpdate = null;
  for (const row of rankings) {
    const name = row.teamName;
    const rank = Number(row.rank);
    if (name && Number.isFinite(rank)) byName.set(normalizeName(name), { rank, name });
    if (row.lastUpdateDate && (!latestUpdate || new Date(row.lastUpdateDate) > new Date(latestUpdate))) {
      latestUpdate = row.lastUpdateDate;
    }
  }

  return {
    byName,
    date: latestUpdate?.slice(0, 10) ?? pageData?.props?.pageProps?.pageData?.ranking?.lastUpdateDate?.slice(0, 10) ?? "live",
    sourceUrl: FIFA_RANKING_PAGE
  };
}

async function fetchTransfermarktValues() {
  const byName = new Map();
  for (let page = 1; page <= 4; page += 1) {
    const url = new URL(TRANSFERMARKT_VALUES_URL);
    url.searchParams.set("page", String(page));
    const html = await fetchText(url);
    const rows = [
      ...html.matchAll(/<td class="zentriert">(\d+)<\/td>[\s\S]*?<a title="([^"]+)"[\s\S]*?<td class="rechts"><b>([^<]+)<\/b><\/td>/g)
    ];
    for (const row of rows) {
      const country = row[2];
      const valueText = row[3];
      const marketValueEurM = parseEuroMillions(valueText ?? "");
      if (country && marketValueEurM != null) {
        byName.set(normalizeName(country), { marketValueEurM, country });
      }
    }
  }
  return {
    byName,
    sourceUrl: TRANSFERMARKT_VALUES_URL
  };
}

async function upsertTeamInputs(inputs) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file)
  });
  const db = fs.existsSync(DB_PATH) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH))) : new SQL.Database();
  ensureSchema(db);
  const existing = existingInputs(db);
  for (const input of inputs) {
    const current = existing.get(input.teamName);
    db.run(
      `INSERT INTO team_inputs (
         team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m,
         injuries, suspensions, key_absences, lineup_checked_at, updated_at, source_url
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_name) DO UPDATE SET
         fifa_rank = excluded.fifa_rank,
         market_value_eur_m = excluded.market_value_eur_m,
         projected_xi_value_eur_m = COALESCE(team_inputs.projected_xi_value_eur_m, excluded.projected_xi_value_eur_m),
         injuries = team_inputs.injuries,
         suspensions = team_inputs.suspensions,
         key_absences = team_inputs.key_absences,
         lineup_checked_at = team_inputs.lineup_checked_at,
         updated_at = excluded.updated_at,
         source_url = excluded.source_url`,
      [
        input.teamName,
        input.fifaRank,
        input.marketValueEurM,
        input.projectedXIValueEurM,
        current?.injuries ?? input.injuries,
        current?.suspensions ?? input.suspensions,
        current?.keyAbsences ?? input.keyAbsences,
        current?.lineupCheckedAt ?? input.lineupCheckedAt,
        input.updatedAt,
        input.sourceUrl
      ]
    );
  }
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  return inputs.length;
}

function ensureSchema(db) {
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
}

function existingInputs(db) {
  const result = db.exec(
    `SELECT team_name, injuries, suspensions, key_absences, lineup_checked_at
     FROM team_inputs`
  );
  const map = new Map();
  for (const row of result[0]?.values ?? []) {
    map.set(String(row[0]), {
      injuries: Number(row[1]),
      suspensions: Number(row[2]),
      keyAbsences: Number(row[3]),
      lineupCheckedAt: row[4] == null ? null : String(row[4])
    });
  }
  return map;
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

function parseEuroMillions(text) {
  const cleaned = text.replace(/\s+/g, "").replace(",", ".");
  const match = cleaned.match(/€([0-9.]+)(bn|m|k)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  if (unit === "bn") return amount * 1000;
  if (unit === "k") return amount / 1000;
  return amount;
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
