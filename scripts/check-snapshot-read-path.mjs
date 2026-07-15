import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, ".local", "worldcup.sqlite");
if (!fs.existsSync(DB_PATH)) throw new Error("missing .local/worldcup.sqlite");

const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
try {
  const plan = db.exec(`
    EXPLAIN QUERY PLAN
    SELECT snapshot_id
    FROM prediction_snapshots
    WHERE match_id = 'M095'
      AND model_version = 'market-only-v1'
      AND generated_at < kickoff_time
    ORDER BY generated_at DESC
    LIMIT 1
  `)[0]?.values.flat().join(" ") ?? "";
  if (!plan.includes("idx_prediction_snapshots_latest")) throw new Error(`latest snapshot query is not using index: ${plan}`);
  console.log(JSON.stringify({ latestSnapshotIndex: "idx_prediction_snapshots_latest", plan }, null, 2));
} finally {
  db.close();
}
