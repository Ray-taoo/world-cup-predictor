import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const root = process.cwd();
const snapshotDir = path.resolve(process.env.SITE_SNAPSHOT_DIR ?? path.join(root, ".snapshot"));
const dataDir = path.resolve(process.env.WORLD_CUP_DATA_DIR ?? path.join(root, ".local"));
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const databaseId = required("D1_DATABASE_ID");
const token = required("CLOUDFLARE_API_TOKEN");
const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, "manifest.json"), "utf8"));
const pendingRequests = await rows("SELECT request_id FROM sync_requests WHERE status = 'pending' ORDER BY requested_at LIMIT 50");
let targetRunId = "slot-a";

try {
  await updateRequests(pendingRequests, "running");
  const dataCounts = await publishCurrentResults();
  const active = (await rows(`
    SELECT active.active_run_id AS run_id, runs.checksum
    FROM site_snapshot_pointer AS active
    JOIN site_snapshot_runs AS runs ON runs.run_id = active.active_run_id
    WHERE active.id = 1
  `))[0];
  if (active?.checksum === manifest.checksum) {
    await updateRequests(pendingRequests, "completed");
    console.log(JSON.stringify({ ok: true, skipped: true, activeRunId: active.run_id, sourceRunId: manifest.runId, dataCounts }, null, 2));
    process.exit(0);
  }
  targetRunId = active?.run_id === "slot-a" ? "slot-b" : "slot-a";
  await query(`
    INSERT INTO site_snapshot_runs
      (run_id, generated_at, source_updated_at, schema_version, checksum, status, error)
    VALUES (?, ?, ?, ?, ?, 'staging', NULL)
    ON CONFLICT(run_id) DO UPDATE SET
      generated_at = excluded.generated_at,
      source_updated_at = excluded.source_updated_at,
      schema_version = excluded.schema_version,
      checksum = excluded.checksum,
      status = 'staging',
      error = NULL
  `, [targetRunId, manifest.generatedAt, manifest.sourceUpdatedAt, manifest.schemaVersion, manifest.checksum]);

  for (const page of manifest.pages) {
    const payload = fs.readFileSync(path.join(snapshotDir, "pages", `${page.pageKey}.json`), "utf8");
    await query(`
      INSERT INTO site_page_snapshots (run_id, page_key, payload_json, checksum, generated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id, page_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        checksum = excluded.checksum,
        generated_at = excluded.generated_at
    `, [targetRunId, page.pageKey, payload, page.checksum, manifest.generatedAt]);
  }

  const validation = await rows(
    "SELECT page_key, checksum FROM site_page_snapshots WHERE run_id = ? ORDER BY page_key",
    [targetRunId]
  );
  if (validation.length !== manifest.pages.length) throw new Error(`remote page count ${validation.length} does not match manifest`);
  for (const page of manifest.pages) {
    if (validation.find((row) => row.page_key === page.pageKey)?.checksum !== page.checksum) {
      throw new Error(`remote checksum mismatch: ${page.pageKey}`);
    }
  }

  await query("UPDATE site_snapshot_runs SET status = 'ready', error = NULL WHERE run_id = ?", [targetRunId]);
  await query(`
    INSERT INTO site_snapshot_pointer (id, active_run_id, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET active_run_id = excluded.active_run_id, updated_at = excluded.updated_at
  `, [targetRunId, manifest.generatedAt]);
  await updateRequests(pendingRequests, "completed");
  console.log(JSON.stringify({ ok: true, activeRunId: targetRunId, sourceRunId: manifest.runId, pages: validation.length, dataCounts }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await query("UPDATE site_snapshot_runs SET status = 'failed', error = ? WHERE run_id = ?", [message.slice(0, 1000), targetRunId]).catch(() => undefined);
  await updateRequests(pendingRequests, "failed", message).catch(() => undefined);
  throw error;
}

async function publishCurrentResults() {
  const databasePath = path.join(dataDir, "worldcup.sqlite");
  if (!fs.existsSync(databasePath)) throw new Error(`runner database missing: ${databasePath}`);
  const SQL = await initSqlJs({ locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(fs.readFileSync(databasePath));
  const overrides = localRows(db, "SELECT match_id, home_score, away_score, note, updated_at FROM overrides");
  const statuses = localRows(db, "SELECT * FROM result_sync_status");
  db.close();

  await upsertRows("overrides", overrides, ["match_id", "home_score", "away_score", "note", "updated_at"], "match_id", 20);
  if (statuses.length) {
    const columns = Object.keys(statuses[0]);
    await upsertRows("result_sync_status", statuses, columns, "match_id", 3);
  }

  const contextFile = path.join(dataDir, "match-context.json");
  const contexts = fs.existsSync(contextFile) ? JSON.parse(fs.readFileSync(contextFile, "utf8")) : { matches: [] };
  const contextRows = (contexts.matches ?? []).map((row) => ({
    match_id: row.matchId,
    payload_json: JSON.stringify(row),
    updated_at: contexts.updatedAt ?? manifest.generatedAt
  }));
  await upsertRows("match_context", contextRows, ["match_id", "payload_json", "updated_at"], "match_id", 10);
  return { overrides: overrides.length, result_sync_status: statuses.length, match_context: contextRows.length };
}

async function upsertRows(table, records, columns, conflictColumn, chunkSize) {
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    const updates = columns.filter((column) => column !== conflictColumn)
      .map((column) => `${column}=excluded.${column}`).join(",");
    const params = chunk.flatMap((record) => columns.map((column) => record[column]));
    await query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders} ON CONFLICT(${conflictColumn}) DO UPDATE SET ${updates}`, params);
  }
}

function localRows(db, sql) {
  const result = db.exec(sql)[0];
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) : [];
}

async function updateRequests(requests, status, error = null) {
  if (!requests.length) return;
  const ids = requests.map((row) => row.request_id);
  const placeholders = ids.map(() => "?").join(",");
  await query(`UPDATE sync_requests SET status = ?, completed_at = ?, error = ? WHERE request_id IN (${placeholders})`, [
    status,
    status === "running" ? null : new Date().toISOString(),
    error ? String(error).slice(0, 1000) : null,
    ...ids
  ]);
}

async function rows(sql, params = []) {
  const result = await query(sql, params);
  return result?.[0]?.results ?? [];
}

async function query(sql, params = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const detail = body?.errors?.map((item) => item.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return body.result;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
