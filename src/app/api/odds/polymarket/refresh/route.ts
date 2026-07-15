import { NextResponse } from "next/server";
import { insertOdds } from "@/lib/db";
import { fetchPolymarketQuotes, fetchPolymarketWinnerStrength } from "@/lib/odds";
import { upsertTeamMarketStrength } from "@/lib/team-market-strength";

export const runtime = "nodejs";

export async function POST() {
  try {
    const [quotes, strength] = await Promise.all([fetchPolymarketQuotes(), fetchPolymarketWinnerStrength()]);
    const count = await insertOdds(quotes);
    const strengthCount = upsertTeamMarketStrength(strength);
    return NextResponse.json({ ok: true, count, strengthCount, matchIds: [...new Set(quotes.map((quote) => quote.matchId))] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Polymarket 鍒锋柊澶辫触" }, { status: 502 });
  }
}
