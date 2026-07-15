import { NextResponse } from "next/server";
import { insertOdds } from "@/lib/db";
import { fetchNansenPredictionMarketQuotes, fetchNansenWinnerStrength } from "@/lib/odds";
import { upsertTeamMarketStrength } from "@/lib/team-market-strength";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "鏈厤缃?NANSEN_API_KEY" }, { status: 400 });
  }

  try {
    const [quotes, strength] = await Promise.all([fetchNansenPredictionMarketQuotes(apiKey), fetchNansenWinnerStrength(apiKey)]);
    const count = await insertOdds(quotes);
    const strengthCount = upsertTeamMarketStrength(strength);
    return NextResponse.json({ ok: true, count, strengthCount, matchIds: [...new Set(quotes.map((quote) => quote.matchId))] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Nansen 鍒锋柊澶辫触" }, { status: 502 });
  }
}
