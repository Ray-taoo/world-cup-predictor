import { data, getTeam } from "@/lib/data";
import { predictionForMatch } from "@/lib/model";
import type { GroupId, OddsQuote, OverrideResult, StandingRow, TeamInput } from "@/lib/types";

export function groupStandings(
  overrides: OverrideResult[],
  odds: OddsQuote[],
  teamInputs: TeamInput[] = []
): Record<GroupId, StandingRow[]> {
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const byGroup = Object.fromEntries(
    data.groups.map((group) => [
      group.id,
      group.teams.map((team) => emptyRow(group.id, team))
    ])
  ) as Record<GroupId, StandingRow[]>;

  for (const match of data.fixtures) {
    const home = byGroup[match.group].find((row) => row.team === match.home);
    const away = byGroup[match.group].find((row) => row.team === match.away);
    if (!home || !away) continue;
    const override = overrideMap.get(match.id);
    if (override) {
      applyActual(home, away, override.homeScore, override.awayScore);
    } else {
      const prediction = predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs);
      applyExpected(home, away, prediction.blended.home, prediction.blended.draw, prediction.blended.away, prediction.xgHome, prediction.xgAway);
    }
  }

  for (const group of data.groups) {
    byGroup[group.id] = rankRows(byGroup[group.id]);
  }
  return byGroup;
}

export function bestThirds(standings: Record<GroupId, StandingRow[]>): StandingRow[] {
  return Object.values(standings)
    .map((rows) => rows[2])
    .filter(Boolean)
    .sort(compareRows)
    .slice(0, 8);
}

export function rankRows(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort(compareRows);
}

export function latestOddsMap(odds: OddsQuote[]): Map<string, OddsQuote> {
  const map = new Map<string, OddsQuote>();
  for (const quote of odds) {
    const current = map.get(quote.matchId);
    if (!current || compareQuoteFreshness(quote, current) > 0) map.set(quote.matchId, quote);
  }
  return map;
}

export function oddsQuotesByMatchMap(odds: OddsQuote[]): Map<string, OddsQuote[]> {
  const map = new Map<string, OddsQuote[]>();
  for (const quote of odds) {
    const rows = map.get(quote.matchId) ?? [];
    rows.push(quote);
    map.set(quote.matchId, rows);
  }
  return map;
}

function compareQuoteFreshness(a: OddsQuote, b: OddsQuote): number {
  const quotePriority: Record<OddsQuote["quoteType"], number> = {
    closing: 3,
    current: 2,
    opening: 1
  };
  const priorityDiff = quotePriority[a.quoteType] - quotePriority[b.quoteType];
  if (priorityDiff !== 0) return priorityDiff;
  return a.fetchedAt.localeCompare(b.fetchedAt);
}

function compareRows(a: StandingRow, b: StandingRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return b.elo - a.elo;
}

function emptyRow(group: GroupId, team: string): StandingRow {
  return {
    team,
    group,
    played: 0,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    expectedPoints: 0,
    elo: getTeam(team).elo
  };
}

function applyActual(home: StandingRow, away: StandingRow, homeScore: number, awayScore: number): void {
  home.played += 1;
  away.played += 1;
  home.goalsFor += homeScore;
  home.goalsAgainst += awayScore;
  away.goalsFor += awayScore;
  away.goalsAgainst += homeScore;
  if (homeScore > awayScore) {
    home.points += 3;
    home.wins += 1;
    away.losses += 1;
  } else if (homeScore < awayScore) {
    away.points += 3;
    away.wins += 1;
    home.losses += 1;
  } else {
    home.points += 1;
    away.points += 1;
    home.draws += 1;
    away.draws += 1;
  }
  home.expectedPoints = home.points;
  away.expectedPoints = away.points;
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}

function applyExpected(home: StandingRow, away: StandingRow, homeWin: number, draw: number, awayWin: number, xgHome: number, xgAway: number): void {
  home.expectedPoints += homeWin * 3 + draw;
  away.expectedPoints += awayWin * 3 + draw;
  home.points = home.expectedPoints;
  away.points = away.expectedPoints;
  home.goalsFor += xgHome;
  home.goalsAgainst += xgAway;
  away.goalsFor += xgAway;
  away.goalsAgainst += xgHome;
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}
