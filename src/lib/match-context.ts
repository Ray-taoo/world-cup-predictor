import fs from "node:fs";
import path from "node:path";
import { getD1 } from "@/lib/cloudflare";
import type { MatchContextInput } from "@/lib/types";

export async function readMatchContexts(): Promise<Map<string, MatchContextInput>> {
  const d1 = await getD1();
  if (d1) {
    const { results } = await d1.prepare("SELECT match_id, payload_json FROM match_context").bind().all<Record<string, unknown>>();
    return new Map(results.flatMap((row) => {
      try { return [[String(row.match_id), JSON.parse(String(row.payload_json)) as MatchContextInput] as const]; } catch { return []; }
    }));
  }
  const file = path.join(process.env.WORLD_CUP_DATA_DIR ?? path.join(process.cwd(), ".local"), "match-context.json");
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { matches?: MatchContextInput[] };
    return new Map((payload.matches ?? []).map((row) => [row.matchId, row]));
  } catch {
    return new Map();
  }
}
