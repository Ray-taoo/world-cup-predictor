import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "src", "data", "generated-data.json");
const SNAPSHOT_PATH = path.join(ROOT, "src", "data", "nightly-snapshot.json");
const ODDS_URL = "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds";

loadLocalEnv();

const generated = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const apiKey = process.env.ODDS_API_KEY;
const now = new Date().toISOString();
const targetDates = [
  beijingDateKey(new Date().toISOString()),
  beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
];
const targetFixtures = generated.fixtures.filter((match) => targetDates.includes(beijingDateKey(match.sortDate)));
const targetMatchIds = new Set(targetFixtures.map((match) => match.id));

const snapshot = {
  generatedAt: now,
  state: {
    status: "ok",
    lastAttemptAt: now,
    lastSuccessAt: now,
    beijingRunDate: beijingDateKey(now),
    targetDate: targetDates.join(","),
    targetMatches: targetFixtures.length,
    oddsFetched: 0,
    oddsImported: 0,
    oddsMatchIds: [],
    missingOddsMatchIds: targetFixtures.map((match) => match.id),
    lineupPendingMatches: targetFixtures.map((match) => match.id),
    note: "云端刷新已运行；未配置 ODDS_API_KEY，因此只更新了核对状态，赔率等待免费 API key。"
  },
  odds: []
};

if (apiKey) {
  const quotes = await fetchTheOddsApiQuotes(apiKey);
  const scopedQuotes = quotes.filter((quote) => targetMatchIds.has(quote.matchId));
  const oddsMatchIds = [...new Set(scopedQuotes.map((quote) => quote.matchId))];
  snapshot.state.oddsFetched = quotes.length;
  snapshot.state.oddsImported = scopedQuotes.length;
  snapshot.state.oddsMatchIds = oddsMatchIds;
  snapshot.state.missingOddsMatchIds = targetFixtures.filter((match) => !oddsMatchIds.includes(match.id)).map((match) => match.id);
  snapshot.state.note = scopedQuotes.length
    ? `云端 21:00 自动刷新成功，已写入近期 ${oddsMatchIds.length} 场比赛赔率；首发/伤停仍需赛前人工复核。`
    : "云端 21:00 自动刷新已运行，但 The Odds API 当前没有返回近期可匹配赔率；首发/伤停仍需赛前人工复核。";
  snapshot.odds = scopedQuotes;
}

fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify(snapshot.state, null, 2));

async function fetchTheOddsApiQuotes(key) {
  const url = new URL(ODDS_URL);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("apiKey", key);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`The Odds API failed: ${response.status} ${body.slice(0, 180)}`);
  }
  const events = await response.json();
  const quotes = [];
  for (const event of events) {
    const fixture = generated.fixtures.find(
      (match) =>
        (sameTeam(match.home, event.home_team) && sameTeam(match.away, event.away_team)) ||
        (sameTeam(match.home, event.away_team) && sameTeam(match.away, event.home_team))
    );
    if (!fixture) continue;
    quotes.push(...quotesFromEvent(fixture, event));
  }
  return quotes;
}

function quotesFromEvent(fixture, event) {
  const quotes = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === "h2h");
    if (!market) continue;
    const home = market.outcomes.find((outcome) => sameTeam(outcome.name, fixture.home));
    const away = market.outcomes.find((outcome) => sameTeam(outcome.name, fixture.away));
    const draw = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "draw");
    if (!home || !away || !draw) continue;
    quotes.push({
      matchId: fixture.id,
      provider: bookmaker.title,
      homePrice: home.price,
      drawPrice: draw.price,
      awayPrice: away.price,
      quoteType: "current",
      marketKind: "sportsbook",
      fetchedAt: bookmaker.last_update ?? now,
      sourceUrl: "https://the-odds-api.com/sports/fifa-world-cup-odds.html"
    });
  }
  return quotes;
}

function beijingDateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function sameTeam(a, b) {
  return normalizeName(a) === normalizeName(b);
}

function normalizeName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/^united states$/, "usa")
    .replace(/^korea republic$/, "south korea")
    .replace(/^ir iran$/, "iran")
    .replace(/^czechia$/, "czech republic")
    .replace(/^turkiye$/, "turkey")
    .replace(/^cote d ivoire$/, "ivory coast")
    .replace(/^congo dr$/, "dr congo")
    .replace(/^cabo verde$/, "cape verde");
}

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
