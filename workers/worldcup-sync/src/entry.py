from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from worldcup_sync_service import LocalSqliteStore, run_full_sync, run_recent_sync


def open_local_store(env: dict[str, Any] | None = None) -> LocalSqliteStore:
    db_path = (env or {}).get("LOCAL_DB_PATH") or ".local/worldcup-sync.sqlite"
    store = LocalSqliteStore(str(db_path))
    store.migrate()
    return store


def run_local(action: str, env: dict[str, Any] | None = None) -> dict[str, Any]:
    if action not in {"full", "recent", "retry-analysis"}:
        return {"ok": False, "error": "unknown action"}
    store = open_local_store(env)
    try:
        if action == "full":
            summary = run_full_sync(store)
        elif action == "recent":
            summary = run_recent_sync(store)
        else:
            summary = {"events": 0, "upserted": 0, "completed": 0, "unknown_stage": 0, "tbd": 0}
        status = "partial" if int(summary.get("failed_dates", 0)) else "ok"
        record_sync_run(store, action, status, summary, str(summary.get("error") or "") or None)
        return {"ok": True, "status": status, "action": action, "finishedAt": datetime.now(timezone.utc).isoformat(), **summary}
    finally:
        store.close()


def record_sync_run(store: LocalSqliteStore, action: str, status: str, summary: dict[str, Any], error: str | None = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    store.conn.execute(
        """
        INSERT INTO sync_runs (
          sync_type, status, started_at, finished_at, events_found, matches_upserted,
          completed_results, unknown_stage, tbd_matches, failed_dates, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            action,
            status,
            now,
            now,
            int(summary.get("events", 0)),
            int(summary.get("upserted", 0)),
            int(summary.get("completed", 0)),
            int(summary.get("unknown_stage", 0)),
            int(summary.get("tbd", 0)),
            int(summary.get("failed_dates", 0)),
            error,
        ),
    )
    store.conn.commit()


async def on_fetch(request: Any, env: Any, ctx: Any) -> Any:
    path = getattr(getattr(request, "url", ""), "path", None) or str(getattr(request, "url", ""))
    if path.endswith("/health"):
        return json_response(health_payload(env_to_dict(env)))
    if path.endswith("/internal/sync/full"):
        return json_response(run_local("full", env_to_dict(env)))
    if path.endswith("/internal/sync/recent"):
        return json_response(run_local("recent", env_to_dict(env)))
    if path.endswith("/internal/sync/retry-analysis"):
        return json_response(run_local("retry-analysis", env_to_dict(env)))
    return json_response({"ok": False, "error": "not found"}, status=404)


async def on_scheduled(controller: Any, env: Any, ctx: Any) -> None:
    cron = str(getattr(controller, "cron", ""))
    action = "full" if cron.startswith("0 ") else "recent"
    run_local(action, env_to_dict(env))


def json_response(payload: dict[str, Any], status: int = 200) -> Any:
    try:
        from workers import Response  # type: ignore

        return Response(json.dumps(payload), status=status, headers={"content-type": "application/json"})
    except Exception:
        return {"status": status, "body": payload}


def env_to_dict(env: Any) -> dict[str, Any]:
    if isinstance(env, dict):
        return env
    return {key: getattr(env, key) for key in dir(env) if key.isupper()}


def health_payload(env: dict[str, Any] | None = None) -> dict[str, Any]:
    store = open_local_store(env)
    try:
        row = store.conn.execute(
            "SELECT sync_type, status, finished_at, failed_dates, events_found, matches_upserted FROM sync_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        latest = dict(row) if row else None
        return {"ok": True, "service": "worldcup-sync", "latestSync": latest}
    finally:
        store.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["full", "recent", "retry-analysis", "health"])
    parser.add_argument("--db", default=".local/worldcup-sync.sqlite")
    args = parser.parse_args()
    if args.action == "health":
        print(json.dumps(health_payload({"LOCAL_DB_PATH": args.db}), indent=2))
    else:
        print(json.dumps(run_local(args.action, {"LOCAL_DB_PATH": args.db}), indent=2))
