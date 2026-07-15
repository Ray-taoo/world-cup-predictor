import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const root = process.cwd();
const output = path.join(root, ".local", "d1-import");
const SQL = await initSqlJs({ locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file) });
const statements = [];

appendSqlite(path.join(root, ".local", "worldcup.sqlite"), [
  "overrides", "odds_quotes", "team_inputs", "result_sync_status", "prediction_input_bundles", "prediction_snapshots", "result_sync_events"
]);
appendSqlite(path.join(root, ".local", "worldcup-sync.sqlite"), ["matches", "sync_runs"]);
appendMatchContext();
appendTeamMarketStrength();

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const chunkSize = 750;
for (let index = 0; index < statements.length; index += chunkSize) {
  const file = path.join(output, `${String(index / chunkSize + 1).padStart(3, "0")}.sql`);
  fs.writeFileSync(file, `${statements.slice(index, index + chunkSize).join("\n")}\n`, "utf8");
}
console.log(JSON.stringify({ statements: statements.length, files: Math.ceil(statements.length / chunkSize), output }, null, 2));

function appendSqlite(file, tables) {
  if (!fs.existsSync(file)) return;
  const db = new SQL.Database(fs.readFileSync(file));
  for (const table of tables) {
    const columns = (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1]));
    if (!columns.length) continue;
    const rows = db.exec(`SELECT ${columns.join(", ")} FROM ${table}`)[0]?.values ?? [];
    const seen = new Set();
    for (const row of rows) {
      const record = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
      if (table === "odds_quotes") {
        const values = [record.match_id, record.external_event_id, record.provider, record.home_price, record.draw_price, record.away_price, record.total_line, record.over_price, record.under_price, record.handicap_line, record.home_handicap_price, record.away_handicap_price, record.btts_yes_price, record.btts_no_price, record.quote_type, record.market_kind, record.fetched_at, record.source_url];
        const dedupeKey = JSON.stringify(values);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        statements.push(insert("odds_quotes", ["dedupe_key", ...values.map((_, index) => ["match_id", "external_event_id", "provider", "home_price", "draw_price", "away_price", "total_line", "over_price", "under_price", "handicap_line", "home_handicap_price", "away_handicap_price", "btts_yes_price", "btts_no_price", "quote_type", "market_kind", "fetched_at", "source_url"][index])], [dedupeKey, ...values], "IGNORE"));
      } else if (table === "result_sync_events") {
        const key = JSON.stringify([record.match_id, record.external_match_id, record.source_name, record.source_url, record.match_status, record.home_score, record.away_score, record.checked_at, record.error]);
        if (seen.has(key)) continue;
        seen.add(key);
        statements.push(insert(table, ["dedupe_key", ...columns.filter((column) => column !== "id")], [key, ...columns.filter((column) => column !== "id").map((column) => record[column])], "IGNORE"));
      } else {
        statements.push(insert(table, columns.filter((column) => column !== "id"), columns.filter((column) => column !== "id").map((column) => record[column]), "REPLACE"));
      }
    }
  }
  db.close();
}

function appendMatchContext() {
  const file = path.join(root, ".local", "match-context.json");
  if (!fs.existsSync(file)) return;
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const row of payload.matches ?? []) statements.push(insert("match_context", ["match_id", "payload_json", "updated_at"], [row.matchId, JSON.stringify(row), payload.updatedAt ?? new Date().toISOString()], "REPLACE"));
}

function appendTeamMarketStrength() {
  const file = path.join(root, ".local", "team-market-strength.json");
  if (!fs.existsSync(file)) return;
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const row of payload.rows ?? []) statements.push(insert("team_market_strength", ["provider", "team", "probability", "source_url", "fetched_at"], [row.provider, row.team, row.probability, row.sourceUrl, row.fetchedAt], "REPLACE"));
}

function insert(table, columns, values, mode) {
  return `INSERT OR ${mode} INTO ${table} (${columns.join(", ")}) VALUES (${values.map(sql).join(", ")});`;
}

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
