import generated from "@/data/generated-data.json";
import type { GeneratedData, Team } from "@/lib/types";

export const data = generated as GeneratedData;

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
