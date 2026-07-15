import { NextResponse } from "next/server";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { readMatchContexts } from "@/lib/match-context";
import { predictionForMatch } from "@/lib/model";
import { compareModelVersions } from "@/lib/model-variants";
import { buildModelIterationState } from "@/lib/model-iteration";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import type { OddsQuote } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const iteration = buildModelIterationState(overrides, odds, teamInputs);
  const contextMap = await readMatchContexts();
  const generatedAt = new Date().toISOString();
  const requestedMatchIds = new Set(new URL(request.url).searchParams.getAll("matchId"));
  const matches = data.fixtures
    .filter((match) => requestedMatchIds.size ? requestedMatchIds.has(match.id) : !overrideMap.has(match.id))
    .filter((match) => requestedMatchIds.size ? true : new Date(match.sortDate).getTime() > Date.now())
    .filter((match) => !isTbd(match.home) && !isTbd(match.away))
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.matchNumber - b.matchNumber)
    .slice(0, 12)
    .map((match) => {
      const matchOdds = oddsMap.get(match.id) ?? null;
      const baseline = predictionForMatch(match, matchOdds, teamInputs, { iteration, overrides });
      return {
        matchId: match.id,
        kickoffTime: match.sortDate,
        home: match.home,
        away: match.away,
        oddsTimestamp: latestOddsTimestamp(matchOdds),
        baselineReference: baseline.blended,
        comparison: compareModelVersions(match, matchOdds, teamInputs, baseline, contextMap.get(match.id) ?? null)
      };
    });

  return NextResponse.json({ generatedAt, matches });
}

function isTbd(value: string): boolean {
  return /winner|loser|runner-up|tbd|third|match \d+/i.test(value);
}

function latestOddsTimestamp(odds: OddsQuote[] | null): string | null {
  return odds?.map((quote) => quote.fetchedAt).sort().at(-1) ?? null;
}
