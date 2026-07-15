import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, ".local", "worldcup.sqlite");
if (!fs.existsSync(DB_PATH)) {
  console.log(JSON.stringify({ snapshots: 0, dbSizeBytes: 0 }, null, 2));
  process.exit(0);
}

const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
const hasTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_snapshots'")[0]?.values.length;
if (!hasTable) {
  db.close();
  console.log(JSON.stringify({ snapshots: 0, dbSizeBytes: fs.statSync(DB_PATH).size }, null, 2));
  process.exit(0);
}

const total = scalar("SELECT COUNT(*) FROM prediction_snapshots");
const bundles = scalar("SELECT COUNT(*) FROM prediction_input_bundles");
const fullMatrices = scalar("SELECT COUNT(*) FROM prediction_snapshots WHERE full_score_matrix_json IS NOT NULL");
const bytes = fs.statSync(DB_PATH).size;
const byModel = rows("SELECT model_version, COUNT(*) FROM prediction_snapshots GROUP BY model_version");
const byType = rows("SELECT snapshot_type, COUNT(*) FROM prediction_snapshots GROUP BY snapshot_type");
const lambdaTotalRows = hasColumn("prediction_snapshots", "lambda_final_total") ? scalar("SELECT COUNT(*) FROM prediction_snapshots WHERE lambda_final_total IS NOT NULL") : 0;
const marketTotalRows = hasColumn("prediction_snapshots", "lambda_market_total") ? scalar("SELECT COUNT(*) FROM prediction_snapshots WHERE lambda_market_total IS NOT NULL") : 0;
const avgPayload = Math.round(Number(db.exec(`
  SELECT AVG(
    LENGTH(snapshot_id) + LENGTH(match_id) + LENGTH(model_version) + LENGTH(snapshot_type) +
    LENGTH(generated_at) + LENGTH(kickoff_time) + LENGTH(input_hash) + LENGTH(feature_hash) +
    LENGTH(config_hash) + LENGTH(COALESCE(git_commit, '')) + LENGTH(market_data_quality) +
    LENGTH(top10_scorelines_json) + LENGTH(COALESCE(full_score_matrix_json, '')) +
    LENGTH(feature_contributions_json)
  )
  FROM prediction_snapshots
`)[0]?.values[0]?.[0] ?? 0));
const avgDb = total ? Math.round(bytes / total) : 0;
db.close();

console.log(JSON.stringify({ snapshots: total, dbSizeBytes: bytes, byModel, byType, fullMatrices, inputBundles: bundles, dedupeSavedRows: Math.max(0, total - bundles), lambdaTotalRows, marketTotalRows, averageBytesPerSnapshot: avgPayload, averageDbBytesPerSnapshot: avgDb }, null, 2));

function scalar(sql) {
  return Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);
}

function rows(sql) {
  return Object.fromEntries((db.exec(sql)[0]?.values ?? []).map((row) => [String(row[0]), Number(row[1])]));
}

function hasColumn(table, column) {
  return (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).some((row) => String(row[1]) === column);
}
