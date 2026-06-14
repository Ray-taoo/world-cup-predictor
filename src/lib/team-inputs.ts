import { data } from "@/lib/data";
import { canonicalTeamNameFromInput } from "@/lib/i18n";
import type { TeamInput } from "@/lib/types";

export function parseTeamInputCsv(csv: string): TeamInput[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((name) => name.trim());
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  if (!("teamName" in idx)) throw new Error("CSV 缺少字段：teamName");

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const rawTeamName = value(cols, idx, "teamName");
    const teamName = canonicalTeamName(rawTeamName);
    if (!teamName) throw new Error(`找不到球队：${rawTeamName}`);

    const input: TeamInput = {
      teamName,
      fifaRank: nullableNumber(value(cols, idx, "fifaRank")),
      marketValueEurM: nullableNumber(value(cols, idx, "marketValueEurM")),
      projectedXIValueEurM: nullableNumber(value(cols, idx, "projectedXIValueEurM")),
      injuries: nonNegativeInteger(value(cols, idx, "injuries")),
      suspensions: nonNegativeInteger(value(cols, idx, "suspensions")),
      keyAbsences: nonNegativeInteger(value(cols, idx, "keyAbsences")),
      lineupCheckedAt: nullableDate(value(cols, idx, "lineupCheckedAt")),
      updatedAt: value(cols, idx, "updatedAt") || new Date().toISOString(),
      sourceUrl: value(cols, idx, "sourceUrl") || "manual-team-csv"
    };
    return input;
  });
}

function canonicalTeamName(input: string): string | null {
  const direct = canonicalTeamNameFromInput(input);
  if (direct) return direct;
  const normalized = normalizeName(input);
  return data.teams.find((team) => normalizeName(team.name) === normalized)?.name ?? null;
}

function nullableNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`数值格式不正确：${raw}`);
  return parsed;
}

function nullableDate(raw: string): string | null {
  if (!raw.trim()) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`时间格式不正确：${raw}`);
  return parsed.toISOString();
}

function nonNegativeInteger(raw: string): number {
  if (!raw.trim()) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`缺阵人数必须是非负整数：${raw}`);
  return parsed;
}

function value(cols: string[], idx: Record<string, number>, key: string): string {
  const position = idx[key];
  return position == null ? "" : (cols[position] ?? "").trim();
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
