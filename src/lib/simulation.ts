import { data, getTeam } from "@/lib/data";
import { modelProbabilities, predictionForMatch } from "@/lib/model";
import { bestThirds, groupStandings, oddsQuotesByMatchMap, rankRows } from "@/lib/standings";
import type { BracketMatch, GroupId, ModelIterationState, OddsQuote, OverrideResult, SimulationResult, StandingRow, TeamInput } from "@/lib/types";

interface SimRow {
  team: string;
  group: GroupId;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  elo: number;
}

interface KnockoutPair {
  id: number;
  homeLabel: string;
  awayLabel: string;
  homeTeam: string;
  awayTeam: string;
}

const groups = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as GroupId[];
let simulationCache: { key: string; value: SimulationResult } | null = null;

const r32Template = [
  { id: 73, home: "A2", away: "B2", label: ["Runner-up Group A", "Runner-up Group B"] },
  { id: 74, home: "E1", awayThird: ["A", "B", "C", "D", "F"], label: ["Winner Group E", "Best 3rd A/B/C/D/F"] },
  { id: 75, home: "F1", away: "C2", label: ["Winner Group F", "Runner-up Group C"] },
  { id: 76, home: "C1", away: "F2", label: ["Winner Group C", "Runner-up Group F"] },
  { id: 77, home: "I1", awayThird: ["C", "D", "F", "G", "H"], label: ["Winner Group I", "Best 3rd C/D/F/G/H"] },
  { id: 78, home: "E2", away: "I2", label: ["Runner-up Group E", "Runner-up Group I"] },
  { id: 79, home: "A1", awayThird: ["C", "E", "F", "H", "I"], label: ["Winner Group A", "Best 3rd C/E/F/H/I"] },
  { id: 80, home: "L1", awayThird: ["E", "H", "I", "J", "K"], label: ["Winner Group L", "Best 3rd E/H/I/J/K"] },
  { id: 81, home: "D1", awayThird: ["B", "E", "F", "I", "J"], label: ["Winner Group D", "Best 3rd B/E/F/I/J"] },
  { id: 82, home: "G1", awayThird: ["A", "E", "H", "I", "J"], label: ["Winner Group G", "Best 3rd A/E/H/I/J"] },
  { id: 83, home: "K2", away: "L2", label: ["Runner-up Group K", "Runner-up Group L"] },
  { id: 84, home: "H1", away: "J2", label: ["Winner Group H", "Runner-up Group J"] },
  { id: 85, home: "B1", awayThird: ["E", "F", "G", "I", "J"], label: ["Winner Group B", "Best 3rd E/F/G/I/J"] },
  { id: 86, home: "J1", away: "H2", label: ["Winner Group J", "Runner-up Group H"] },
  { id: 87, home: "K1", awayThird: ["D", "E", "I", "J", "L"], label: ["Winner Group K", "Best 3rd D/E/I/J/L"] },
  { id: 88, home: "D2", away: "G2", label: ["Runner-up Group D", "Runner-up Group G"] }
] as const;

const r16Template = [
  [89, 75, 78],
  [90, 73, 76],
  [91, 74, 77],
  [92, 79, 80],
  [93, 84, 83],
  [94, 82, 81],
  [95, 87, 86],
  [96, 85, 88]
] as const;

const qfTemplate = [
  [97, 89, 90],
  [98, 93, 94],
  [99, 91, 92],
  [100, 95, 96]
] as const;

const sfTemplate = [
  [101, 97, 98],
  [102, 99, 100]
] as const;

export function runSimulation(
  overrides: OverrideResult[],
  odds: OddsQuote[],
  teamInputs: TeamInput[] = [],
  simulations = 10000,
  iteration?: ModelIterationState | null
): SimulationResult {
  const cacheKey = JSON.stringify({
    simulations,
    overrides: overrides.map((row) => [row.matchId, row.homeScore, row.awayScore, row.updatedAt]),
    odds: [odds.length, odds[0]?.fetchedAt ?? null],
    teams: teamInputs.map((row) => [row.teamName, row.updatedAt]),
    iteration: iteration ? [iteration.sampleSize, iteration.adjustments] : null
  });
  if (simulationCache?.key === cacheKey) return simulationCache.value;
  const oddsMap = oddsQuotesByMatchMap(odds);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const fixturePredictions = new Map(
    data.fixtures.map((match) => [match.id, predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { iteration, overrides })])
  );
  const advanceCache = new Map<string, number>();
  const counts = Object.fromEntries(
    data.teams.map((team) => [
      team.name,
      {
        roundOf32: 0,
        roundOf16: 0,
        quarterFinal: 0,
        semiFinal: 0,
        final: 0,
        champion: 0
      }
    ])
  ) as SimulationResult["teams"];

  for (let i = 0; i < simulations; i += 1) {
    const random = seededRandom(20260605 + i);
    const rankedGroups = simulateGroupStage(random, overrideMap, fixturePredictions);
    const thirdRanked = groups.map((group) => rankedGroups[group][2]).sort(compareRows).slice(0, 8);
    const r32 = buildR32(rankedGroups, thirdRanked);
    const qualified = new Set<string>();
    for (const pair of r32) {
      qualified.add(pair.homeTeam);
      qualified.add(pair.awayTeam);
    }
    for (const team of qualified) counts[team].roundOf32 += 1;

    const r32Winners = playRound(r32, random, advanceCache, teamInputs, iteration);
    for (const team of r32Winners.values()) counts[team].roundOf16 += 1;
    const r16 = bracketFromWinnerTemplate(r16Template, r32Winners);
    const r16Winners = playRound(r16, random, advanceCache, teamInputs, iteration);
    for (const team of r16Winners.values()) counts[team].quarterFinal += 1;
    const qf = bracketFromWinnerTemplate(qfTemplate, r16Winners);
    const qfWinners = playRound(qf, random, advanceCache, teamInputs, iteration);
    for (const team of qfWinners.values()) counts[team].semiFinal += 1;
    const sf = bracketFromWinnerTemplate(sfTemplate, qfWinners);
    const sfWinners = playRound(sf, random, advanceCache, teamInputs, iteration);
    for (const team of sfWinners.values()) counts[team].final += 1;
    const finalPair = bracketFromWinnerTemplate([[104, 101, 102]], sfWinners);
    const champion = playRound(finalPair, random, advanceCache, teamInputs, iteration).get(104);
    if (champion) counts[champion].champion += 1;
  }

  for (const team of Object.keys(counts)) {
    counts[team].roundOf32 /= simulations;
    counts[team].roundOf16 /= simulations;
    counts[team].quarterFinal /= simulations;
    counts[team].semiFinal /= simulations;
    counts[team].final /= simulations;
    counts[team].champion /= simulations;
  }

  const value = {
    simulations,
    teams: counts,
    projectedBracket: projectedBracket(overrides, odds, teamInputs, iteration)
  };
  simulationCache = { key: cacheKey, value };
  return value;
}

export function projectedBracket(overrides: OverrideResult[], odds: OddsQuote[], teamInputs: TeamInput[] = [], iteration?: ModelIterationState | null): BracketMatch[] {
  const standings = groupStandings(overrides, odds, teamInputs, iteration);
  const thirdRows = bestThirds(standings);
  const r32 = buildR32(
    Object.fromEntries(groups.map((group) => [group, standings[group]])) as Record<GroupId, StandingRow[]>,
    thirdRows
  );
  const projected: BracketMatch[] = r32.map((pair) => ({
    id: pair.id,
    round: "R32",
    homeLabel: pair.homeLabel,
    awayLabel: pair.awayLabel,
    homeTeam: pair.homeTeam,
    awayTeam: pair.awayTeam
  }));
  for (const [id, left, right] of r16Template) {
    projected.push({ id, round: "R16", homeLabel: `Winner ${left}`, awayLabel: `Winner ${right}` });
  }
  for (const [id, left, right] of qfTemplate) {
    projected.push({ id, round: "QF", homeLabel: `Winner ${left}`, awayLabel: `Winner ${right}` });
  }
  for (const [id, left, right] of sfTemplate) {
    projected.push({ id, round: "SF", homeLabel: `Winner ${left}`, awayLabel: `Winner ${right}` });
  }
  projected.push({ id: 104, round: "Final", homeLabel: "Winner 101", awayLabel: "Winner 102" });
  return projected;
}

function simulateGroupStage(
  random: () => number,
  overrideMap: Map<string, OverrideResult>,
  fixturePredictions: Map<string, ReturnType<typeof predictionForMatch>>
): Record<GroupId, SimRow[]> {
  const table = Object.fromEntries(
    data.groups.map((group) => [
      group.id,
      group.teams.map((team) => ({
        team,
        group: group.id,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        elo: getTeam(team).elo
      }))
    ])
  ) as Record<GroupId, SimRow[]>;

  for (const match of data.fixtures) {
    const home = table[match.group].find((row) => row.team === match.home);
    const away = table[match.group].find((row) => row.team === match.away);
    if (!home || !away) continue;
    const override = overrideMap.get(match.id);
    if (override) {
      applyScore(home, away, override.homeScore, override.awayScore);
    } else {
      const prediction = fixturePredictions.get(match.id);
      if (!prediction) continue;
      const hs = samplePoisson(prediction.xgHome, random);
      const as = samplePoisson(prediction.xgAway, random);
      applyScore(home, away, hs, as);
    }
  }

  return Object.fromEntries(groups.map((group) => [group, [...table[group]].sort(compareRows)])) as Record<GroupId, SimRow[]>;
}

function buildR32(rankedGroups: Record<GroupId, Array<Pick<StandingRow, "team" | "group" | "points" | "goalDifference" | "goalsFor" | "elo">>>, thirdRows: Array<Pick<StandingRow, "team" | "group">>): KnockoutPair[] {
  const slots = new Map<string, string>();
  for (const group of groups) {
    slots.set(`${group}1`, rankedGroups[group][0].team);
    slots.set(`${group}2`, rankedGroups[group][1].team);
  }
  const usedThirds = new Set<GroupId>();
  return r32Template.map((slot) => {
    const homeTeam = slots.get(slot.home) ?? "";
    let awayTeam = "";
    if ("away" in slot) {
      awayTeam = slots.get(slot.away) ?? "";
    } else {
      const third = pickThird(slot.awayThird as readonly GroupId[], thirdRows, usedThirds);
      awayTeam = third?.team ?? thirdRows.find((row) => !usedThirds.has(row.group as GroupId))?.team ?? "";
      if (third) usedThirds.add(third.group as GroupId);
    }
    return {
      id: slot.id,
      homeLabel: slot.label[0],
      awayLabel: slot.label[1],
      homeTeam,
      awayTeam
    };
  });
}

function pickThird(allowed: readonly GroupId[], thirdRows: Array<Pick<StandingRow, "team" | "group">>, used: Set<GroupId>) {
  return thirdRows.find((row) => allowed.includes(row.group as GroupId) && !used.has(row.group as GroupId));
}

function bracketFromWinnerTemplate(template: readonly (readonly [number, number, number])[], winners: Map<number, string>): KnockoutPair[] {
  return template.map(([id, left, right]) => ({
    id,
    homeLabel: `Winner ${left}`,
    awayLabel: `Winner ${right}`,
    homeTeam: winners.get(left) ?? "",
    awayTeam: winners.get(right) ?? ""
  }));
}

function playRound(
  matches: KnockoutPair[],
  random: () => number,
  advanceCache: Map<string, number>,
  teamInputs: TeamInput[],
  iteration?: ModelIterationState | null
): Map<number, string> {
  const winners = new Map<number, string>();
  for (const match of matches) {
    winners.set(match.id, knockoutWinner(match.homeTeam, match.awayTeam, random, advanceCache, teamInputs, iteration));
  }
  return winners;
}

function knockoutWinner(
  home: string,
  away: string,
  random: () => number,
  advanceCache: Map<string, number>,
  teamInputs: TeamInput[],
  iteration?: ModelIterationState | null
): string {
  if (!home) return away;
  if (!away) return home;
  const key = `${home}__${away}`;
  let homeAdvance = advanceCache.get(key);
  if (homeAdvance == null) {
    const prediction = modelProbabilities(home, away, teamInputs, iteration);
    const homePenaltyShare = getTeam(home).elo / (getTeam(home).elo + getTeam(away).elo);
    homeAdvance = prediction.home + prediction.draw * homePenaltyShare;
    advanceCache.set(key, homeAdvance);
  }
  return random() < homeAdvance ? home : away;
}

function applyScore(home: SimRow, away: SimRow, homeScore: number, awayScore: number): void {
  home.goalsFor += homeScore;
  home.goalsAgainst += awayScore;
  away.goalsFor += awayScore;
  away.goalsAgainst += homeScore;
  if (homeScore > awayScore) home.points += 3;
  else if (homeScore < awayScore) away.points += 3;
  else {
    home.points += 1;
    away.points += 1;
  }
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}

function compareRows(a: Pick<StandingRow, "points" | "goalDifference" | "goalsFor" | "elo">, b: Pick<StandingRow, "points" | "goalDifference" | "goalsFor" | "elo">): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return b.elo - a.elo;
}

function samplePoisson(lambda: number, random: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit && k < 9);
  return k - 1;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
