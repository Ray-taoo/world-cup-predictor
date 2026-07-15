import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { getD1 } from "@/lib/cloudflare";
import type { ModelVersion } from "@/lib/model-variants";

const dbDir = process.env.WORLD_CUP_DATA_DIR ?? path.join(process.cwd(), ".local");
const dbPath = path.join(dbDir, "worldcup.sqlite");

export interface LatestPredictionSnapshot {
  matchId: string;
  modelVersion: ModelVersion;
  snapshotType: string;
  generatedAt: string;
  kickoffTime: string;
  marketDataQuality: string;
  probabilityHomeWin: number | null;
  probabilityDraw: number | null;
  probabilityAwayWin: number | null;
  top10Scorelines: unknown[];
}

export async function readLatestPredictionSnapshot(matchId: string, modelVersion: ModelVersion): Promise<LatestPredictionSnapshot | null> {
  const d1 = await getD1();
  if (d1) {
    const row = await d1.prepare(`SELECT match_id, model_version, snapshot_type, generated_at, kickoff_time, market_data_quality,
      probability_home_win, probability_draw, probability_away_win, top10_scorelines_json FROM prediction_snapshots
      WHERE match_id=? AND model_version=? AND generated_at < kickoff_time ORDER BY generated_at DESC LIMIT 1`).bind(matchId, modelVersion).first<Record<string, unknown>>();
    return row ? snapshotRow(row) : null;
  }
  if (!fs.existsSync(dbPath)) return null;
  const SQL = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)));
  try {
    const stmt = db.prepare(`
      SELECT match_id, model_version, snapshot_type, generated_at, kickoff_time, market_data_quality,
             probability_home_win, probability_draw, probability_away_win, top10_scorelines_json
      FROM prediction_snapshots
      WHERE match_id = ?
        AND model_version = ?
        AND generated_at < kickoff_time
      ORDER BY generated_at DESC
      LIMIT 1
    `);
    try {
      stmt.bind([matchId, modelVersion]);
      if (!stmt.step()) return null;
      const row = stmt.getAsObject();
      return {
        matchId: String(row.match_id),
        modelVersion: row.model_version as ModelVersion,
        snapshotType: String(row.snapshot_type),
        generatedAt: String(row.generated_at),
        kickoffTime: String(row.kickoff_time),
        marketDataQuality: String(row.market_data_quality),
        probabilityHomeWin: nullableNumber(row.probability_home_win),
        probabilityDraw: nullableNumber(row.probability_draw),
        probabilityAwayWin: nullableNumber(row.probability_away_win),
        top10Scorelines: JSON.parse(String(row.top10_scorelines_json ?? "[]"))
      };
    } finally {
      stmt.free();
    }
  } finally {
    db.close();
  }
}

function snapshotRow(row: Record<string, unknown>): LatestPredictionSnapshot {
  return {
    matchId: String(row.match_id), modelVersion: row.model_version as ModelVersion, snapshotType: String(row.snapshot_type), generatedAt: String(row.generated_at),
    kickoffTime: String(row.kickoff_time), marketDataQuality: String(row.market_data_quality), probabilityHomeWin: nullableNumber(row.probability_home_win),
    probabilityDraw: nullableNumber(row.probability_draw), probabilityAwayWin: nullableNumber(row.probability_away_win), top10Scorelines: JSON.parse(String(row.top10_scorelines_json ?? "[]"))
  };
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}
