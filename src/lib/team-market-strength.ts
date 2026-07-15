import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { data } from "@/lib/data";

const filePath = join(process.cwd(), ".local", "team-market-strength.json");

export interface TeamMarketStrengthInput {
  team: string;
  probability: number;
  provider: string;
  sourceUrl: string;
}

interface TeamMarketStrengthFile {
  updatedAt: string;
  rows: Array<TeamMarketStrengthInput & { fetchedAt: string }>;
}

export function readTeamMarketStrength(): Map<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TeamMarketStrengthFile;
    const rows = parsed.rows ?? [];
    const grouped = new Map<string, number[]>();
    for (const row of rows) {
      if (!Number.isFinite(row.probability) || row.probability <= 0) continue;
      grouped.set(row.team, [...(grouped.get(row.team) ?? []), row.probability]);
    }
    return new Map([...grouped.entries()].map(([team, values]) => [team, median(values)]));
  } catch {
    return new Map();
  }
}

export function upsertTeamMarketStrength(rows: TeamMarketStrengthInput[]): number {
  if (!rows.length) return 0;
  const existing = readFileRows();
  const fetchedAt = new Date().toISOString();
  const byKey = new Map(existing.map((row) => [`${row.provider}:${row.team}`, row]));
  for (const row of rows) {
    byKey.set(`${row.provider}:${row.team}`, { ...row, fetchedAt });
  }
  const payload: TeamMarketStrengthFile = {
    updatedAt: fetchedAt,
    rows: [...byKey.values()].sort((a, b) => a.team.localeCompare(b.team) || a.provider.localeCompare(b.provider))
  };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return rows.length;
}

export function knownTeamName(text: string): string | null {
  const lower = normalize(text);
  return data.teams.find((team) => lower.includes(normalize(team.name)))?.name ?? null;
}

function readFileRows(): TeamMarketStrengthFile["rows"] {
  try {
    return (JSON.parse(readFileSync(filePath, "utf8")) as TeamMarketStrengthFile).rows ?? [];
  } catch {
    return [];
  }
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}
