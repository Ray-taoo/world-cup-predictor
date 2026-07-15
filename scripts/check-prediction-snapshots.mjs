import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, ".local", "worldcup.sqlite");
const PAGE_SIZE = 500;
const ALLOWED_MODELS = new Set(["market-only-v1", "baseline-v1-market-elo", "hybrid-v2-knockout"]);
const LAMBDA_PREFIXES = ["market", "team", "final"];

if (!fs.existsSync(DB_PATH)) throw new Error("missing .local/worldcup.sqlite");

const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));

try {
  requireTable("prediction_snapshots");
  requireTable("prediction_input_bundles");
  const duplicateKeys = scalar(`
    SELECT COUNT(*) FROM (
      SELECT match_id, model_version, snapshot_type, input_hash
      FROM prediction_snapshots
      GROUP BY match_id, model_version, snapshot_type, input_hash
      HAVING COUNT(*) > 1
    )
  `);
  if (duplicateKeys) throw new Error(`duplicate snapshot keys: ${duplicateKeys}`);

  const missingBundles = scalar(`
    SELECT COUNT(*)
    FROM prediction_snapshots s
    LEFT JOIN prediction_input_bundles b ON b.input_hash = s.input_hash
    WHERE b.input_hash IS NULL
  `);
  if (missingBundles) throw new Error(`snapshots without input bundle: ${missingBundles}`);

  let contextBundles = 0;
  for (const row of db.exec("SELECT payload_json FROM prediction_input_bundles")[0]?.values ?? []) {
    const payload = parseJson(row[0], "input bundle", "payload_json");
    const context = payload.variant?.contextInputs;
    if (payload.version !== "hybrid-v2-knockout" || !context) continue;
    if (context.squad && (!context.squad.externalEventId || !context.squad.fetchedAt || !context.squad.sourceUrl)) {
      throw new Error(`${payload.matchId}: squad context missing source audit fields`);
    }
    if (context.weather && (!context.weather.fetchedAt || !context.weather.sourceUrl)) {
      throw new Error(`${payload.matchId}: weather context missing source audit fields`);
    }
    contextBundles += 1;
  }
  if (!contextBundles) throw new Error("no strict snapshot input bundle contains real match context");

  let checked = 0;
  let finalPrematch = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = db.exec(`
      SELECT
        snapshot_id, model_version, snapshot_type, generated_at, kickoff_time,
        top10_scorelines_json, full_score_matrix_json,
        lambda_market_home, lambda_market_away, lambda_market_total, lambda_market_difference,
        lambda_team_home, lambda_team_away, lambda_team_total, lambda_team_difference,
        lambda_final_home, lambda_final_away, lambda_final_total, lambda_final_difference
      FROM prediction_snapshots
      ORDER BY generated_at, snapshot_id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `)[0]?.values ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      checked += 1;
      checkRow(row);
      if (String(row[2]) === "FINAL_PREMATCH") finalPrematch += 1;
    }
  }

  console.log(JSON.stringify({ predictionSnapshotsChecked: checked, finalPrematch, duplicateKeys, missingBundles, contextBundles }, null, 2));
} finally {
  db.close();
}

function checkRow(row) {
  const [
    snapshotId,
    modelVersion,
    snapshotType,
    generatedAt,
    kickoffTime,
    top10Json,
    fullMatrixJson,
    marketHome,
    marketAway,
    marketTotal,
    marketDifference,
    teamHome,
    teamAway,
    teamTotal,
    teamDifference,
    finalHome,
    finalAway,
    finalTotal,
    finalDifference
  ] = row;
  const label = String(snapshotId);
  if (!ALLOWED_MODELS.has(String(modelVersion))) throw new Error(`${label}: unexpected model_version ${modelVersion}`);
  if (!(new Date(String(generatedAt)).getTime() < new Date(String(kickoffTime)).getTime())) {
    throw new Error(`${label}: generated_at must be before kickoff_time`);
  }
  const top10 = parseJson(top10Json, label, "top10_scorelines_json");
  if (!Array.isArray(top10) || top10.length > 10) throw new Error(`${label}: top10_scorelines_json must contain at most 10 rows`);
  if (snapshotType === "FINAL_PREMATCH") {
    const matrix = parseJson(fullMatrixJson, label, "full_score_matrix_json");
    if (!Array.isArray(matrix) || !matrix.length) throw new Error(`${label}: FINAL_PREMATCH requires full_score_matrix_json`);
  } else if (fullMatrixJson !== null) {
    throw new Error(`${label}: only FINAL_PREMATCH may store full_score_matrix_json`);
  }
  checkLambda(label, "market", marketHome, marketAway, marketTotal, marketDifference);
  checkLambda(label, "team", teamHome, teamAway, teamTotal, teamDifference);
  checkLambda(label, "final", finalHome, finalAway, finalTotal, finalDifference);
}

function checkLambda(label, prefix, home, away, total, difference) {
  if (home === null && away === null && total === null && difference === null) return;
  if (home === null || away === null || total === null || difference === null) {
    throw new Error(`${label}: incomplete ${prefix} lambda columns`);
  }
  approx(label, `${prefix} lambda total`, Number(total), Number(home) + Number(away));
  approx(label, `${prefix} lambda difference`, Number(difference), Number(home) - Number(away));
}

function approx(label, field, actual, expected) {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${label}: bad ${field}: ${actual} != ${expected}`);
}

function parseJson(value, label, field) {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label}: invalid ${field}: ${error.message}`);
  }
}

function requireTable(table) {
  const exists = scalar(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '${table}'`);
  if (!exists) throw new Error(`missing table ${table}`);
}

function scalar(sql) {
  return Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0);
}
