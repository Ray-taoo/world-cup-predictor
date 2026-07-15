import { data } from "@/lib/data";
import { knownTeamName, type TeamMarketStrengthInput } from "@/lib/team-market-strength";
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
      totalLine: optionalNumber(value(cols, idx, "totalLine")),
      overPrice: optionalNumber(value(cols, idx, "overPrice")),
      underPrice: optionalNumber(value(cols, idx, "underPrice")),
      handicapLine: optionalNumber(value(cols, idx, "handicapLine")),
      homeHandicapPrice: optionalNumber(value(cols, idx, "homeHandicapPrice")),
      awayHandicapPrice: optionalNumber(value(cols, idx, "awayHandicapPrice")),
      bttsYesPrice: optionalNumber(value(cols, idx, "bttsYesPrice")),
      bttsNoPrice: optionalNumber(value(cols, idx, "bttsNoPrice")),
      quoteType,
      marketKind,
      fetchedAt: value(cols, idx, "fetchedAt") || new Date().toISOString(),
      sourceUrl: value(cols, idx, "sourceUrl") || (marketKind === "prediction_market" ? "polymarket-manual-csv" : marketKind === "smart_wallet" ? "smart-wallet-manual-csv" : "manual-csv")
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
  for (const markets of ["h2h,spreads,totals", "h2h"]) {
    try {
      const quotes = await fetchTheOddsApiQuotesForMarkets(apiKey, markets);
      return mergeBttsQuotes(quotes, await fetchTheOddsApiBtts(apiKey, quotes));
    } catch (error) {
      if (markets === "h2h") throw error;
    }
  }
  return [];
}

async function fetchTheOddsApiBtts(apiKey: string, quotes: OddsQuote[]): Promise<Map<string, Pick<OddsQuote, "bttsYesPrice" | "bttsNoPrice" | "fetchedAt" | "sourceUrl">>> {
  const events = new Map(quotes.filter((quote) => quote.externalEventId).map((quote) => [quote.externalEventId as string, quote.matchId]));
  const rows = new Map<string, Pick<OddsQuote, "bttsYesPrice" | "bttsNoPrice" | "fetchedAt" | "sourceUrl">>();
  for (const [eventId, matchId] of events) {
    try {
      const url = new URL(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${eventId}/odds`);
      url.searchParams.set("regions", "eu");
      url.searchParams.set("markets", "btts");
      url.searchParams.set("oddsFormat", "decimal");
      url.searchParams.set("apiKey", apiKey);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const event = (await response.json()) as OddsApiEvent;
      for (const bookmaker of event.bookmakers ?? []) {
        const btts = bttsMarket(bookmaker.markets ?? []);
        if (!btts) continue;
        rows.set(`${matchId}\0${bookmaker.title}`, {
          bttsYesPrice: btts.yes,
          bttsNoPrice: btts.no,
          fetchedAt: bookmaker.last_update ?? new Date().toISOString(),
          sourceUrl: `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${eventId}/odds`
        });
      }
    } catch {
      // ponytail: one event failure must not discard other real odds.
    }
  }
  return rows;
}

function mergeBttsQuotes(
  quotes: OddsQuote[],
  bttsRows: Map<string, Pick<OddsQuote, "bttsYesPrice" | "bttsNoPrice" | "fetchedAt" | "sourceUrl">>
): OddsQuote[] {
  return quotes.map((quote) => {
    const btts = bttsRows.get(`${quote.matchId}\0${quote.provider}`);
    return btts ? { ...quote, ...btts } : quote;
  });
}

async function fetchTheOddsApiQuotesForMarkets(apiKey: string, markets: string): Promise<OddsQuote[]> {
  const url = new URL("https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds");
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", markets);
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

export async function fetchPolymarketQuotes(): Promise<OddsQuote[]> {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Polymarket 璇锋眰澶辫触锛?{response.status} ${body.slice(0, 180)}`);
  }

  const markets = (await response.json()) as PolymarketMarket[];
  const byMatch = new Map<string, Partial<Record<"home" | "draw" | "away", number>>>();
  for (const market of markets) {
    const text = normalizeName(`${market.question ?? ""} ${market.slug ?? ""}`);
    const yes = yesPrice(market);
    if (yes == null) continue;

    for (const fixture of data.fixtures) {
      const home = normalizeName(fixture.home);
      const away = normalizeName(fixture.away);
      if (!text.includes(home) || !text.includes(away)) continue;

      const side = polymarketSide(text, home, away);
      if (!side) continue;
      const row = byMatch.get(fixture.id) ?? {};
      row[side] = yes;
      byMatch.set(fixture.id, row);
    }
  }

  const fetchedAt = new Date().toISOString();
  return [...byMatch.entries()].flatMap(([matchId, probs]) => {
    if (!probs.home || !probs.draw || !probs.away) return [];
    const sum = probs.home + probs.draw + probs.away;
    if (sum <= 0) return [];
    return [{
      matchId,
      provider: "Polymarket",
      homePrice: probabilityToPrice(probs.home / sum),
      drawPrice: probabilityToPrice(probs.draw / sum),
      awayPrice: probabilityToPrice(probs.away / sum),
      quoteType: "current",
      marketKind: "prediction_market",
      fetchedAt,
      sourceUrl: "https://gamma-api.polymarket.com/markets"
    }];
  });
}

export async function fetchPolymarketWinnerStrength(): Promise<TeamMarketStrengthInput[]> {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", "500");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return [];
  const markets = (await response.json()) as PolymarketMarket[];
  return markets.flatMap((market) => {
    const text = `${market.question ?? ""} ${market.slug ?? ""}`;
    if (!/win.*2026.*world cup|2026.*world cup.*winner/i.test(text)) return [];
    const team = knownTeamName(text);
    const probability = yesPrice(market);
    if (!team || probability == null) return [];
    return [{ team, probability, provider: "Polymarket Winner", sourceUrl: "https://gamma-api.polymarket.com/markets" }];
  });
}

export async function fetchNansenPredictionMarketQuotes(apiKey: string): Promise<OddsQuote[]> {
  const body = {
    query: "world cup",
    status: "active",
    pagination: { page: 1, per_page: 100 },
    min_liquidity: -1,
    max_liquidity: -1,
    min_volume_24hr: -1,
    min_open_interest: -1,
    max_open_interest: -1,
    max_unique_traders_24h: -1,
    min_price: -1,
    max_price: -1,
    order_by: [{ direction: "DESC", field: "volume_24hr" }]
  };
  const response = await fetch("https://api.nansen.ai/api/v1/prediction-market/market-screener", {
    method: "POST",
    headers: {
      apiKey,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Nansen 鐠囬攱鐪版径杈Е閿?{response.status} ${text.slice(0, 180)}`);
  }

  const payload = (await response.json()) as NansenMarketScreenerResponse;
  const byMatch = new Map<string, Partial<Record<"home" | "draw" | "away", number>>>();
  for (const market of payload.data ?? []) {
    const text = normalizeName(`${market.question ?? ""} ${market.slug ?? ""} ${market.event_title ?? ""}`);
    const price = nansenPrice(market);
    if (price == null) continue;

    for (const fixture of data.fixtures) {
      const home = normalizeName(fixture.home);
      const away = normalizeName(fixture.away);
      if (!text.includes(home) || !text.includes(away)) continue;

      const side = polymarketSide(text, home, away);
      if (!side) continue;
      const row = byMatch.get(fixture.id) ?? {};
      row[side] = price;
      byMatch.set(fixture.id, row);
    }
  }

  const fetchedAt = new Date().toISOString();
  return [...byMatch.entries()].flatMap(([matchId, probs]) => {
    if (!probs.home || !probs.draw || !probs.away) return [];
    const sum = probs.home + probs.draw + probs.away;
    if (sum <= 0) return [];
    return [{
      matchId,
      provider: "Nansen Prediction Market",
      homePrice: probabilityToPrice(probs.home / sum),
      drawPrice: probabilityToPrice(probs.draw / sum),
      awayPrice: probabilityToPrice(probs.away / sum),
      quoteType: "current",
      marketKind: "prediction_market",
      fetchedAt,
      sourceUrl: "https://api.nansen.ai/api/v1/prediction-market/market-screener"
    }];
  });
}

export async function fetchNansenWinnerStrength(apiKey: string): Promise<TeamMarketStrengthInput[]> {
  const markets = await fetchNansenMarkets(apiKey, "world cup");
  return markets.flatMap((market) => {
    const text = `${market.question ?? ""} ${market.slug ?? ""} ${market.event_title ?? ""}`;
    if (!/win.*2026.*world cup|world cup winner/i.test(text)) return [];
    const team = knownTeamName(text);
    const probability = nansenPrice(market);
    if (!team || probability == null) return [];
    return [{ team, probability, provider: "Nansen Winner", sourceUrl: "https://api.nansen.ai/api/v1/prediction-market/market-screener" }];
  });
}

async function fetchNansenMarkets(apiKey: string, query: string): Promise<NansenMarket[]> {
  const body = {
    query,
    status: "active",
    pagination: { page: 1, per_page: 100 },
    min_liquidity: -1,
    max_liquidity: -1,
    min_volume_24hr: -1,
    min_open_interest: -1,
    max_open_interest: -1,
    max_unique_traders_24h: -1,
    min_price: -1,
    max_price: -1,
    order_by: [{ direction: "DESC", field: "volume_24hr" }]
  };
  const response = await fetch("https://api.nansen.ai/api/v1/prediction-market/market-screener", {
    method: "POST",
    headers: { apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Nansen 鐠囬攱鐪版径杈Е閿?{response.status} ${text.slice(0, 180)}`);
  }
  return ((await response.json()) as NansenMarketScreenerResponse).data ?? [];
}

function quotesFromEvent(matchId: string, fixtureHome: string, fixtureAway: string, event: OddsApiEvent): OddsQuote[] {
  const quotes: OddsQuote[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const h2h = bookmaker.markets?.find((item) => item.key === "h2h");
    if (!h2h) continue;
    const home = h2h.outcomes.find((outcome) => sameTeam(outcome.name, fixtureHome));
    const away = h2h.outcomes.find((outcome) => sameTeam(outcome.name, fixtureAway));
    const draw = h2h.outcomes.find((outcome) => outcome.name.toLowerCase() === "draw");
    if (home && away && draw) {
      const total = totalsMarket(bookmaker.markets ?? []);
      const spread = spreadsMarket(bookmaker.markets ?? [], fixtureHome, fixtureAway);
      const btts = bttsMarket(bookmaker.markets ?? []);
      quotes.push({
        matchId,
        externalEventId: event.id,
        provider: bookmaker.title,
        homePrice: home.price,
        drawPrice: draw.price,
        awayPrice: away.price,
        totalLine: total?.line ?? null,
        overPrice: total?.over ?? null,
        underPrice: total?.under ?? null,
        handicapLine: spread?.line ?? null,
        homeHandicapPrice: spread?.home ?? null,
        awayHandicapPrice: spread?.away ?? null,
        bttsYesPrice: btts?.yes ?? null,
        bttsNoPrice: btts?.no ?? null,
        quoteType: "current",
        marketKind: "sportsbook",
        fetchedAt: bookmaker.last_update ?? new Date().toISOString(),
        sourceUrl: `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${event.id}/odds`
      });
    }
  }
  return quotes;
}

function totalsMarket(markets: OddsApiMarket[]): { line: number; over: number; under: number } | null {
  const market = markets.find((item) => item.key === "totals");
  if (!market) return null;
  const lines = [...new Set(market.outcomes.map((outcome) => outcome.point).filter((point): point is number => Number.isFinite(point)))];
  const line = lines.sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5))[0];
  const over = market.outcomes.find((outcome) => outcome.point === line && /^over$/i.test(outcome.name));
  const under = market.outcomes.find((outcome) => outcome.point === line && /^under$/i.test(outcome.name));
  return line != null && over && under ? { line, over: over.price, under: under.price } : null;
}

function spreadsMarket(markets: OddsApiMarket[], fixtureHome: string, fixtureAway: string): { line: number; home: number; away: number } | null {
  const market = markets.find((item) => item.key === "spreads");
  const homeRows = market?.outcomes.filter((outcome) => sameTeam(outcome.name, fixtureHome) && Number.isFinite(outcome.point)) ?? [];
  const home = homeRows.sort((a, b) => Math.abs((a.point ?? 0)) - Math.abs((b.point ?? 0)))[0];
  if (!market || !home || home.point == null) return null;
  const homePoint = home.point;
  const away = market.outcomes.find((outcome) => sameTeam(outcome.name, fixtureAway) && outcome.point === -homePoint);
  return away ? { line: home.point, home: home.price, away: away.price } : null;
}

function bttsMarket(markets: OddsApiMarket[]): { yes: number; no: number } | null {
  const market = markets.find((item) => ["btts", "both_teams_to_score"].includes(item.key));
  const yes = market?.outcomes.find((outcome) => /^yes$/i.test(outcome.name));
  const no = market?.outcomes.find((outcome) => /^no$/i.test(outcome.name));
  return yes && no ? { yes: yes.price, no: no.price } : null;
}

function probabilityToPrice(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return Number.NaN;
  return 1 / probability;
}

function optionalNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuoteType(value: string): OddsQuote["quoteType"] {
  const lower = value.trim().toLowerCase();
  if (["open", "opening", "early"].includes(lower)) return "opening";
  if (["close", "closing", "final", "pregame"].includes(lower)) return "closing";
  return "current";
}

function normalizeMarketKind(kind: string, provider: string): OddsQuote["marketKind"] {
  const merged = `${kind} ${provider}`.toLowerCase();
  if (merged.includes("smart_wallet") || merged.includes("smart wallet") || merged.includes("wallet") || merged.includes("whale")) return "smart_wallet";
  if (merged.includes("poly") || merged.includes("kalshi") || merged.includes("prediction")) return "prediction_market";
  return "sportsbook";
}

function yesPrice(market: PolymarketMarket): number | null {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map(Number);
  const yesIndex = outcomes.findIndex((item) => item.toLowerCase() === "yes");
  const price = yesIndex >= 0 ? prices[yesIndex] : prices[0];
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

function nansenPrice(market: NansenMarket): number | null {
  const bid = Number(market.best_bid);
  const ask = Number(market.best_ask);
  const last = Number(market.last_trade_price);
  const price = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0 ? (bid + ask) / 2 : last;
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function polymarketSide(text: string, home: string, away: string): "home" | "draw" | "away" | null {
  if (/\bdraw\b|\btie\b/.test(text)) return "draw";
  if (new RegExp(`\\b${escapeRegExp(home)}\\b.*\\b(win|wins|beat|beats|defeat|defeats)\\b`).test(text)) return "home";
  if (new RegExp(`\\b${escapeRegExp(away)}\\b.*\\b(win|wins|beat|beats|defeat|defeats)\\b`).test(text)) return "away";
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  id: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    title: string;
    last_update?: string;
    markets?: OddsApiMarket[];
  }>;
}

interface OddsApiMarket {
  key: string;
  outcomes: Array<{ name: string; price: number; point?: number }>;
}

interface PolymarketMarket {
  question?: string;
  slug?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
}

interface NansenMarketScreenerResponse {
  data?: NansenMarket[];
}

interface NansenMarket {
  question?: string;
  slug?: string;
  event_title?: string;
  best_bid?: number | string;
  best_ask?: number | string;
  last_trade_price?: number | string;
}
