CREATE TABLE IF NOT EXISTS official_availability_reports (
  report_key TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  team_name TEXT NOT NULL,
  player_name TEXT NOT NULL,
  availability_type TEXT NOT NULL,
  status TEXT NOT NULL,
  sanction TEXT,
  source_url TEXT NOT NULL,
  source_published_at TEXT,
  fetched_at TEXT NOT NULL,
  confirmation_status TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS official_availability_sync (
  source_key TEXT PRIMARY KEY,
  report_date TEXT,
  source_url TEXT NOT NULL,
  source_published_at TEXT,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_official_availability_active
  ON official_availability_reports(report_date, active, team_name);
