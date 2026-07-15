CREATE TABLE IF NOT EXISTS site_snapshot_runs (
  run_id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  source_updated_at TEXT,
  schema_version INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS site_page_snapshots (
  run_id TEXT NOT NULL,
  page_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, page_key)
);

CREATE TABLE IF NOT EXISTS site_snapshot_pointer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_requests (
  request_id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_site_page_snapshots_run
  ON site_page_snapshots(run_id, page_key);
CREATE INDEX IF NOT EXISTS idx_sync_requests_status
  ON sync_requests(status, requested_at);
