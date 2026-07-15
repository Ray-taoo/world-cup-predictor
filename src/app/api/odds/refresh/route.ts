import { NextResponse } from "next/server";
import { insertOdds } from "@/lib/db";
import { data } from "@/lib/data";
import { fetchTheOddsApiQuotes } from "@/lib/odds";
import type { OddsQuote } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "未配置 ODDS_API_KEY。网站仍可使用自有模型和手工 CSV 赔率。"
      },
      { status: 400 }
    );
  }

  try {
    const scope = new URL(request.url).searchParams.get("scope");
    const quotes = await fetchTheOddsApiQuotes(apiKey);
    const scopedQuotes = scope === "tomorrow" ? filterTomorrowQuotes(quotes) : quotes;
    const count = await insertOdds(scopedQuotes);
    return NextResponse.json({ ok: true, count, fetched: quotes.length, scope: scope ?? "all", matchIds: [...new Set(scopedQuotes.map((quote) => quote.matchId))] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "赔率刷新失败" }, { status: 502 });
  }
}

function filterTomorrowQuotes(quotes: OddsQuote[]): OddsQuote[] {
  const targetDates = new Set([
    beijingDateKey(new Date().toISOString()),
    beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
  ]);
  const targetMatchIds = new Set(
    data.fixtures
      .filter((match) => targetDates.has(beijingDateKey(match.sortDate)))
      .map((match) => match.id)
  );
  return quotes.filter((quote) => targetMatchIds.has(quote.matchId));
}

function beijingDateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
