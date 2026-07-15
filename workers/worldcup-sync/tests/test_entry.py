from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from entry import health_payload, record_sync_run
from worldcup_sync_service import LocalSqliteStore


def test_record_sync_run_stores_failed_dates() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        store = LocalSqliteStore(str(Path(tmp) / "sync.sqlite"))
        store.migrate()
        try:
            record_sync_run(store, "recent", "partial", {"events": 0, "upserted": 0, "completed": 0, "unknown_stage": 0, "tbd": 0, "failed_dates": 5}, "network failed")
            row = store.conn.execute("SELECT status, failed_dates, error FROM sync_runs").fetchone()
            assert row["status"] == "partial"
            assert row["failed_dates"] == 5
            assert row["error"] == "network failed"
        finally:
            store.close()


def test_health_reports_latest_sync() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = str(Path(tmp) / "sync.sqlite")
        store = LocalSqliteStore(db)
        store.migrate()
        try:
            record_sync_run(store, "recent", "partial", {"events": 0, "upserted": 0, "completed": 0, "unknown_stage": 0, "tbd": 0, "failed_dates": 2})
        finally:
            store.close()
        payload = health_payload({"LOCAL_DB_PATH": db})
        assert payload["ok"] is True
        assert payload["latestSync"]["status"] == "partial"
        assert payload["latestSync"]["failed_dates"] == 2


if __name__ == "__main__":
    test_record_sync_run_stores_failed_dates()
    test_health_reports_latest_sync()
    print("worldcup-sync entry tests ok")
