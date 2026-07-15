import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, ".local", "worldcup.sqlite");
const SITE = process.env.WORLDCUP_SITE_URL ?? "http://127.0.0.1:3000";

const response = await fetch(`${SITE.replace(/\/$/, "")}/api/model-comparison`, { cache: "no-store" });
if (!response.ok) throw new Error(`model comparison request failed: ${response.status} ${response.statusText}`);
const payload = await response.json();

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
const db = fs.existsSync(DB_PATH) ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH))) : new SQL.Database();
ensureSchema(db);

let inserted = 0;
let skipped = 0;
for (const match of payload.matches ?? []) {
  const kickoff = new Date(match.kickoffTime);
  const generatedAt = new Date(payload.generatedAt);
  if (!(generatedAt < kickoff)) {
    skipped += 1;
    continue;
  }
  const hours = (kickoff.getTime() - generatedAt.getTime()) / 36e5;
  const snapshotType = snapshotTypeFor(hours);
  for (const variant of match.comparison?.versions ?? []) {
    const includeMatrix = snapshotType === "FINAL_PREMATCH";
    const input = { matchId: match.matchId, kickoffTime: match.kickoffTime, oddsTimestamp: match.oddsTimestamp ?? null, version: variant.version, variant: compactVariant(variant, includeMatrix) };
    const inputHash = hash(input);
    const configHash = hash({ snapshotType, version: variant.version, implementation: "local-model-variants-v1" });
    const featureHash = hash(includeMatrix ? variant.fullScoreMatrix ?? [] : compactVariant(variant, false));
    db.run(
      `INSERT OR IGNORE INTO prediction_input_bundles (input_hash, payload_json, created_at) VALUES (?, ?, ?)`,
      [inputHash, JSON.stringify(input), payload.generatedAt]
    );
    db.run(
      `INSERT OR IGNORE INTO prediction_snapshots (
        snapshot_id, match_id, model_version, snapshot_type, generated_at, kickoff_time, hours_before_kickoff,
        input_data_cutoff, input_hash, feature_hash, config_hash, git_commit, odds_timestamp, market_data_quality,
        lambda_market_home, lambda_market_away, lambda_market_total, lambda_market_difference,
        lambda_team_home, lambda_team_away, lambda_team_total, lambda_team_difference,
        lambda_final_home, lambda_final_away, lambda_final_total, lambda_final_difference,
        probability_home_win, probability_draw, probability_away_win, probability_under_2_5, probability_over_2_5,
        probability_btts_yes, probability_btts_no, probability_extra_time, probability_penalties,
        probability_home_advance, probability_away_advance, top10_scorelines_json, full_score_matrix_json,
        feature_contributions_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hash({ inputHash, snapshotType, version: variant.version }),
        match.matchId,
        variant.version,
        snapshotType,
        payload.generatedAt,
        match.kickoffTime,
        hours,
        payload.generatedAt,
        inputHash,
        featureHash,
        configHash,
        gitCommit(),
        match.oddsTimestamp ?? null,
        variant.marketDataQuality,
        variant.componentLambdas.marketHome,
        variant.componentLambdas.marketAway,
        variant.componentLambdas.marketTotal,
        variant.componentLambdas.marketDifference,
        variant.componentLambdas.teamHome,
        variant.componentLambdas.teamAway,
        variant.componentLambdas.teamTotal,
        variant.componentLambdas.teamDifference,
        variant.componentLambdas.finalHome,
        variant.componentLambdas.finalAway,
        variant.componentLambdas.finalTotal,
        variant.componentLambdas.finalDifference,
        variant.probabilities90.home,
        variant.probabilities90.draw,
        variant.probabilities90.away,
        variant.probabilityUnder25,
        variant.probabilityOver25,
        variant.probabilityBttsYes,
        variant.probabilityBttsNo,
        variant.probabilityExtraTime,
        variant.probabilityPenalties,
        variant.probabilityHomeAdvance,
        variant.probabilityAwayAdvance,
        JSON.stringify((variant.topScorelines ?? []).slice(0, 10)),
        snapshotType === "FINAL_PREMATCH" ? JSON.stringify(variant.fullScoreMatrix ?? []) : null,
        JSON.stringify({ missingMarketInputs: variant.missingMarketInputs, missingContextInputs: variant.missingContextInputs, contextInputs: variant.contextInputs, solverResidual: variant.solverResidual, solverError: variant.solverError, dixonColesRho: variant.dixonColesRho, componentLambdas: variant.componentLambdas, explanation: variant.explanation }),
        payload.generatedAt
      ]
    );
    if (db.getRowsModified() > 0) inserted += 1;
    else skipped += 1;
  }
}

fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
db.close();
console.log(JSON.stringify({ inserted, skipped, matches: payload.matches?.length ?? 0 }, null, 2));

function ensureSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS prediction_input_bundles (
      input_hash TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS prediction_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      kickoff_time TEXT NOT NULL,
      hours_before_kickoff REAL NOT NULL,
      input_data_cutoff TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      feature_hash TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      git_commit TEXT,
      odds_timestamp TEXT,
      market_data_quality TEXT NOT NULL,
      lambda_market_home REAL,
      lambda_market_away REAL,
      lambda_market_total REAL,
      lambda_market_difference REAL,
      lambda_team_home REAL,
      lambda_team_away REAL,
      lambda_team_total REAL,
      lambda_team_difference REAL,
      lambda_final_home REAL,
      lambda_final_away REAL,
      lambda_final_total REAL,
      lambda_final_difference REAL,
      probability_home_win REAL,
      probability_draw REAL,
      probability_away_win REAL,
      probability_under_2_5 REAL,
      probability_over_2_5 REAL,
      probability_btts_yes REAL,
      probability_btts_no REAL,
      probability_extra_time REAL,
      probability_penalties REAL,
      probability_home_advance REAL,
      probability_away_advance REAL,
      top10_scorelines_json TEXT NOT NULL,
      full_score_matrix_json TEXT,
      feature_contributions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(match_id, model_version, snapshot_type, input_hash)
    );
  `);
  for (const column of [
    ["lambda_market_total", "REAL"],
    ["lambda_market_difference", "REAL"],
    ["lambda_team_total", "REAL"],
    ["lambda_team_difference", "REAL"],
    ["lambda_final_total", "REAL"],
    ["lambda_final_difference", "REAL"]
  ]) {
    addColumnIfMissing(db, "prediction_snapshots", column[0], column[1]);
  }
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_latest
    ON prediction_snapshots(match_id, model_version, generated_at DESC);
  `);
  backfillLambdaTotals(db);
}

function addColumnIfMissing(db, table, column, type) {
  const columns = new Set((db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1])));
  if (!columns.has(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function backfillLambdaTotals(db) {
  for (const prefix of ["market", "team", "final"]) {
    db.run(`
      UPDATE prediction_snapshots
      SET
        lambda_${prefix}_total = lambda_${prefix}_home + lambda_${prefix}_away,
        lambda_${prefix}_difference = lambda_${prefix}_home - lambda_${prefix}_away
      WHERE lambda_${prefix}_home IS NOT NULL
        AND lambda_${prefix}_away IS NOT NULL
        AND (lambda_${prefix}_total IS NULL OR lambda_${prefix}_difference IS NULL)
    `);
  }
}

function snapshotTypeFor(hours) {
  if (hours <= 0.75) return "FINAL_PREMATCH";
  if (hours <= 2) return "T-1h";
  if (hours <= 9) return "T-6h";
  return "T-24h";
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function gitCommit() {
  try {
    return execSync("git rev-parse --short=12 HEAD", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function compactVariant(variant, includeMatrix) {
  return {
    version: variant.version,
    lambdaHome: variant.lambdaHome,
    lambdaAway: variant.lambdaAway,
    lambdaTotal: variant.lambdaTotal,
    lambdaDifference: variant.lambdaDifference,
    probabilities90: variant.probabilities90,
    probabilityOver25: variant.probabilityOver25,
    probabilityUnder25: variant.probabilityUnder25,
    probabilityBttsYes: variant.probabilityBttsYes,
    probabilityBttsNo: variant.probabilityBttsNo,
    probabilityExtraTime: variant.probabilityExtraTime,
    probabilityPenalties: variant.probabilityPenalties,
    probabilityHomeAdvance: variant.probabilityHomeAdvance,
    probabilityAwayAdvance: variant.probabilityAwayAdvance,
    topScorelines: variant.topScorelines,
    marketDataQuality: variant.marketDataQuality,
    missingMarketInputs: variant.missingMarketInputs,
    missingContextInputs: variant.missingContextInputs,
    contextInputs: variant.contextInputs,
    solverError: variant.solverError,
    solverResidual: variant.solverResidual,
    dixonColesRho: variant.dixonColesRho,
    componentLambdas: variant.componentLambdas,
    fullScoreMatrix: includeMatrix ? variant.fullScoreMatrix : undefined
  };
}
