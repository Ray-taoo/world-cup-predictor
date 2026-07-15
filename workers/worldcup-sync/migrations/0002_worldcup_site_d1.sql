ALTER TABLE matches ADD COLUMN normal_time_home_score INTEGER;
ALTER TABLE matches ADD COLUMN normal_time_away_score INTEGER;
ALTER TABLE matches ADD COLUMN extra_time_home_score INTEGER;
ALTER TABLE matches ADD COLUMN extra_time_away_score INTEGER;

CREATE TABLE IF NOT EXISTS overrides (
  match_id TEXT PRIMARY KEY,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS odds_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  match_id TEXT NOT NULL,
  external_event_id TEXT,
  provider TEXT NOT NULL,
  home_price REAL NOT NULL,
  draw_price REAL NOT NULL,
  away_price REAL NOT NULL,
  total_line REAL,
  over_price REAL,
  under_price REAL,
  handicap_line REAL,
  home_handicap_price REAL,
  away_handicap_price REAL,
  btts_yes_price REAL,
  btts_no_price REAL,
  quote_type TEXT NOT NULL,
  market_kind TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_odds_quotes_read ON odds_quotes(match_id, provider, quote_type, fetched_at, id);

CREATE TABLE IF NOT EXISTS team_inputs (
  team_name TEXT PRIMARY KEY,
  fifa_rank INTEGER,
  market_value_eur_m REAL,
  projected_xi_value_eur_m REAL,
  injuries INTEGER NOT NULL DEFAULT 0,
  suspensions INTEGER NOT NULL DEFAULT 0,
  key_absences INTEGER NOT NULL DEFAULT 0,
  lineup_checked_at TEXT,
  updated_at TEXT NOT NULL,
  source_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_sync_status (
  match_id TEXT PRIMARY KEY,
  external_match_id TEXT,
  kickoff_time_utc TEXT NOT NULL,
  match_status TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  normal_time_home_score INTEGER,
  normal_time_away_score INTEGER,
  extra_time_score TEXT,
  penalty_score TEXT,
  result_source TEXT,
  result_updated_at TEXT,
  last_result_check_at TEXT NOT NULL,
  result_sync_error TEXT,
  post_match_analysis_status TEXT NOT NULL,
  home_winner INTEGER,
  away_winner INTEGER,
  last_result_source TEXT,
  result_sync_status TEXT NOT NULL,
  result_retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT
);

CREATE TABLE IF NOT EXISTS result_sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  match_id TEXT NOT NULL,
  external_match_id TEXT,
  source_name TEXT,
  source_url TEXT,
  match_status TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  checked_at TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS prediction_input_bundles (
  input_hash TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

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
  lambda_market_home REAL, lambda_market_away REAL, lambda_team_home REAL, lambda_team_away REAL,
  lambda_final_home REAL, lambda_final_away REAL,
  probability_home_win REAL, probability_draw REAL, probability_away_win REAL,
  probability_under_2_5 REAL, probability_over_2_5 REAL, probability_btts_yes REAL, probability_btts_no REAL,
  probability_extra_time REAL, probability_penalties REAL, probability_home_advance REAL, probability_away_advance REAL,
  top10_scorelines_json TEXT NOT NULL,
  full_score_matrix_json TEXT,
  feature_contributions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  lambda_market_total REAL, lambda_market_difference REAL, lambda_team_total REAL, lambda_team_difference REAL,
  lambda_final_total REAL, lambda_final_difference REAL,
  UNIQUE(match_id, model_version, snapshot_type, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_latest ON prediction_snapshots(match_id, model_version, generated_at DESC);

CREATE TABLE IF NOT EXISTS match_context (
  match_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_market_strength (
  provider TEXT NOT NULL,
  team TEXT NOT NULL,
  probability REAL NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(provider, team)
);
