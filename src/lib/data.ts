import generated from "@/data/generated-data.json";
import liveFixtures from "@/data/live-fixtures.json";
import type { Fixture, GeneratedData, Team } from "@/lib/types";

const base = generated as GeneratedData;
const live = liveFixtures as { updatedAt?: string; source?: string; fixtures?: Fixture[] };
const fixtureMap = new Map<string, Fixture>(base.fixtures.map((fixture) => [fixture.id, fixture]));
for (const fixture of live.fixtures ?? []) fixtureMap.set(fixture.id, fixture);

export const data: GeneratedData = {
  ...base,
  generatedAt: latestIso(base.generatedAt, live.updatedAt),
  fixtures: [...fixtureMap.values()].sort((a, b) => a.matchNumber - b.matchNumber),
  sources: live.source
    ? [
        ...base.sources,
        {
          name: "World Cup live schedule sync",
          url: "https://api.sofascore.com/api/v1/unique-tournament/16/season/58210/events",
          fetchedAt: live.updatedAt ?? base.generatedAt,
          usage: live.source
        }
      ]
    : base.sources
};

export const teamByName = new Map<string, Team>(data.teams.map((team) => [team.name, team]));

export function getTeam(name: string): Team {
  const team = teamByName.get(name);
  if (!team) {
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      group: "A",
      confederation: "Unknown",
      isHost: false,
      elo: 1500,
      recentForm: { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      fifaRank: null,
      marketValueEurM: null
    };
  }
  return team;
}

export function orderedTeams(): Team[] {
  return [...data.teams].sort((a, b) => b.elo - a.elo);
}

function latestIso(left: string, right?: string): string {
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}
