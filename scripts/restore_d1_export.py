from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    root = Path.cwd()
    source = Path(sys.argv[1] if len(sys.argv) > 1 else root / ".runner" / "remote.sql").resolve()
    data_dir = Path(sys.argv[2] if len(sys.argv) > 2 else root / ".local").resolve()
    database = data_dir / "worldcup.sqlite"
    if not source.is_file():
        raise FileNotFoundError(f"D1 export not found: {source}")

    data_dir.mkdir(parents=True, exist_ok=True)
    database.unlink(missing_ok=True)
    connection = sqlite3.connect(database)
    try:
        connection.executescript(source.read_text(encoding="utf-8"))
        connection.commit()
        source_updated_at = scalar(connection, "SELECT MAX(updated_at) FROM overrides") or now()
        write_match_context(connection, data_dir, source_updated_at)
        write_team_market_strength(connection, data_dir, source_updated_at)
        write_nightly_state(data_dir, source_updated_at)
        counts = {
            table: int(scalar(connection, f"SELECT COUNT(*) FROM {table}") or 0)
            for table in (
                "overrides",
                "odds_quotes",
                "team_inputs",
                "result_sync_status",
                "prediction_snapshots",
            )
        }
    finally:
        connection.close()

    print(json.dumps({"input": str(source), "output": str(database), "counts": counts}, indent=2))
    return 0


def write_match_context(connection: sqlite3.Connection, data_dir: Path, updated_at: str) -> None:
    rows = connection.execute("SELECT payload_json FROM match_context ORDER BY match_id").fetchall()
    payload = {"updatedAt": updated_at, "matches": [json.loads(row[0]) for row in rows]}
    write_json(data_dir / "match-context.json", payload)


def write_team_market_strength(connection: sqlite3.Connection, data_dir: Path, updated_at: str) -> None:
    rows = connection.execute(
        "SELECT provider, team, probability, source_url, fetched_at FROM team_market_strength ORDER BY team, provider"
    ).fetchall()
    payload = {
        "updatedAt": updated_at,
        "rows": [
            {
                "provider": row[0],
                "team": row[1],
                "probability": row[2],
                "sourceUrl": row[3],
                "fetchedAt": row[4],
            }
            for row in rows
        ],
    }
    write_json(data_dir / "team-market-strength.json", payload)


def write_nightly_state(data_dir: Path, source_updated_at: str) -> None:
    payload = {
        "status": "ok",
        "lastAttemptAt": source_updated_at,
        "lastSuccessAt": source_updated_at,
        "beijingRunDate": source_updated_at[:10],
        "targetDate": source_updated_at[:10],
        "targetMatches": 0,
        "oddsFetched": 0,
        "oddsImported": 0,
        "oddsMatchIds": [],
        "missingOddsMatchIds": [],
        "lineupPendingMatches": [],
        "note": "Cloudflare D1 数据已恢复到临时计算环境；缺失来源保持原状。",
    }
    write_json(data_dir / "nightly-refresh.json", payload)


def scalar(connection: sqlite3.Connection, sql: str):
    row = connection.execute(sql).fetchone()
    return row[0] if row else None


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
