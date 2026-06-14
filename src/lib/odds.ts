import { data } from "@/lib/data";
import type { OddsQuote } from "@/lib/types";

export function parseOddsCsv(csv: string): OddsQuote[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((name) => name.trim());
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  if (!("matchId" in idx)) throw new Error("CSV 缺少字段：matchId");
  if (!("provider" in idx)) throw new Error("CSV 缺少字段：provider");

  const hasPrices = "homePrice" in idx && "drawPrice" in idx && "awayPrice" in idx;
  const hasProbabilities = "homeProb" in idx && "drawProb" in idx && "awayProb" in idx;
  if (!hasPrices && !hasProbabilities) {
    throw new Error("CSV 需要 homePrice/drawPrice/awayPrice 或 homeProb/drawProb/awayProb");
  }

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const quoteType = normalizeQuoteType(value(cols, idx, "quoteType") || value(cols, idx, "priceType"));
    const marketKind = normalizeMarketKind(value(cols, idx, "marketKind"), value(cols, idx, "provider"));
    const quote: OddsQuote = {
      matchId: value(cols, idx, "matchId"),
      provider: value(cols, idx, "provider"),
      homePrice: hasPrices ? Number(value(cols, idx, "homePrice")) : probabilityToPrice(Number(value(cols, idx, "homeProb"))),
      drawPrice: hasPrices ? Number(value(cols, idx, "drawPrice")) : probabilityToPrice(Number(value(cols, idx, "drawProb"))),
      awayPrice: hasPrices ? Number(value(cols, idx, "awayPrice")) : probabilityToPrice(Number(value(cols, idx, "awayProb"))),
      quoteType,
      marketKind,
      fetchedAt: value(cols, idx, "fetchedAt") || new Date().toISOString(),
      sourceUrl: value(cols, idx, "sourceUrl") || (marketKind === "prediction_market" ? "polymarket-manual-csv" : "manual-csv")
    };
    if (!data.fixtures.some((match) => match.id === quote.matchId)) {
      throw new Error(`找不到比赛 ID：${quote.matchId}`);
    }
    if (![quote.homePrice, quote.drawPrice, quote.awayPrice].every((price) => Number.isFinite(price) && price > 1)) {
      throw new Error(`赔率必须大于 1，或概率必须在 0 到 1 之间：${quote.matchId}`);
    }
    return quote;
  });
}

export async function fetchTheOddsApiQuotes(apiKey: string): Promise<OddsQuote[]> {
  const url = new URL("https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds");
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`The Odds API 请求失败：${response.status} ${body.slice(0, 180)}`);
  }
  const events = (await response.json()) as OddsApiEvent[];
  const quotes: OddsQuote[] = [];
  for (const event of events) {
    const fixture = data.fixtures.find(
      (match) =>
        (sameTeam(match.home, event.home_team) && sameTeam(match.away, event.away_team)) ||
        (sameTeam(match.home, event.away_team) && sameTeam(match.away, event.home_team))
    );
    if (!fixture) continue;
    quotes.push(...quotesFromEvent(fixture.id, fixture.home, fixture.away, event));
  }
  return quotes;
}

function quotesFromEvent(matchId: string, fixtureHome: string, fixtureAway: string, event: OddsApiEvent): OddsQuote[] {
  const quotes: OddsQuote[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === "h2h");
    if (!market) continue;
    const home = market.outcomes.find((outcome) => sameTeam(outcome.name, fixtureHome));
    const away = market.outcomes.find((outcome) => sameTeam(outcome.name, fixtureAway));
    const draw = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "draw");
    if (home && away && draw) {
      quotes.push({
        matchId,
        provider: bookmaker.title,
        homePrice: home.price,
        drawPrice: draw.price,
        awayPrice: away.price,
        quoteType: "current",
        marketKind: "sportsbook",
        fetchedAt: bookmaker.last_update ?? new Date().toISOString(),
        sourceUrl: "https://the-odds-api.com/sports/fifa-world-cup-odds.html"
      });
    }
  }
  return quotes;
}

function probabilityToPrice(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return Number.NaN;
  return 1 / probability;
}

function normalizeQuoteType(value: string): OddsQuote["quoteType"] {
  const lower = value.trim().toLowerCase();
  if (["open", "opening", "early"].includes(lower)) return "opening";
  if (["close", "closing", "final", "pregame"].includes(lower)) return "closing";
  return "current";
}

function normalizeMarketKind(kind: string, provider: string): OddsQuote["marketKind"] {
  const merged = `${kind} ${provider}`.toLowerCase();
  if (merged.includes("poly") || merged.includes("kalshi") || merged.includes("prediction")) return "prediction_market";
  return "sportsbook";
}

function value(cols: string[], idx: Record<string, number>, key: string): string {
  const position = idx[key];
  return position == null ? "" : (cols[position] ?? "").trim();
}

function sameTeam(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

function normalizeName(name: string): string {
  return name
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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

interface OddsApiEvent {
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    title: string;
    last_update?: string;
    markets?: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
}
