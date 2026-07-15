from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from worldcup_sync_service import (
    LocalSqliteStore,
    export_live_fixtures,
    map_sofascore_status,
    map_stage_text,
    match_existing_fixture,
    parse_sofascore_event,
    parse_the_odds_api_event,
    resolve_bracket_slot,
    run_sync,
)


def sample_event(
    event_id: int = 90089,
    timestamp: int = 1783184400,
    home: str = "Paraguay",
    away: str = "France",
    status_type: str = "finished",
) -> dict:
    return {
        "id": event_id,
        "startTimestamp": timestamp,
        "customId": "PAR-FRA",
        "status": {"code": 100 if status_type == "finished" else 0, "description": status_type, "type": status_type},
        "winnerCode": 2 if status_type == "finished" else None,
        "roundInfo": {"name": "Round of 16", "round": 5},
        "tournament": {"name": "World Cup"},
        "homeTeam": {"id": 10, "name": home},
        "awayTeam": {"id": 20, "name": away},
        "homeScore": {"current": 1 if status_type == "finished" else None, "normaltime": 1 if status_type == "finished" else None},
        "awayScore": {"current": 2 if status_type == "finished" else None, "normaltime": 2 if status_type == "finished" else None},
        "venue": {"name": "Lincoln Financial Field", "city": {"name": "Philadelphia"}},
    }


def penalty_event() -> dict:
    event = sample_event(event_id=90086, home="Australia", away="Egypt")
    event["roundInfo"] = {"name": "Round of 32", "round": 4}
    event["winnerCode"] = 2
    event["homeScore"] = {"current": 1, "normaltime": 1, "penalties": 2}
    event["awayScore"] = {"current": 1, "normaltime": 1, "penalties": 4}
    return event


def test_parse_sofascore_event() -> None:
    match = parse_sofascore_event(sample_event())
    assert match.external_provider == "sofascore"
    assert match.external_event_id == "90089"
    assert match.home_team_name == "Paraguay"
    assert match.away_team_name == "France"
    assert match.home_score == 1
    assert match.away_score == 2
    assert match.winner_team_name == "France"
    assert match.status == "completed"
    assert match.stage == "ROUND_OF_16"
    assert match.venue == "Lincoln Financial Field, Philadelphia"


def test_parse_the_odds_api_event() -> None:
    match = parse_the_odds_api_event(
        {
            "id": "odds-90",
            "commence_time": "2026-07-04T17:00:00Z",
            "home_team": "Canada",
            "away_team": "Morocco",
        }
    )
    assert match.external_provider == "the_odds_api"
    assert match.external_event_id == "odds-90"
    assert match.home_team_name == "Canada"
    assert match.away_team_name == "Morocco"
    assert match.status == "scheduled"
    assert match.stage == "ROUND_OF_16"


def test_penalty_score_is_separate() -> None:
    match = parse_sofascore_event(penalty_event())
    assert match.home_score == 1
    assert match.away_score == 1
    assert match.home_shootout_score == 2
    assert match.away_shootout_score == 4
    assert match.winner_team_name == "Egypt"


def test_status_and_stage_mapping() -> None:
    assert map_sofascore_status({"type": "notstarted", "code": 0}) == "scheduled"
    assert map_sofascore_status({"type": "inprogress", "code": 42}) == "in_progress"
    assert map_sofascore_status({"type": "finished", "code": 100}) == "completed"
    assert map_sofascore_status({"type": "postponed"}) == "postponed"
    assert map_stage_text("Quarterfinal") == "QUARTER_FINAL"
    assert map_stage_text("", "2026-07-19T19:00:00+00:00") == "FINAL"


def test_local_upsert_is_idempotent_and_updates_score() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "sync.sqlite"
        store = LocalSqliteStore(str(db))
        store.local_fixtures = [
            {
                "id": "M089",
                "home": "Paraguay",
                "away": "France",
                "stage": "round_of_16",
                "sortDate": "2026-07-04T21:00:00.000Z",
            }
        ]
        store.migrate()
        try:
            scheduled = sample_event(status_type="notstarted")
            first = run_sync(store, [scheduled])
            second = run_sync(store, [sample_event()])
            rows = store.conn.execute("SELECT COUNT(*) AS count FROM matches").fetchone()["count"]
            row = store.conn.execute("SELECT local_match_id, status, home_score, away_score FROM matches").fetchone()
            assert first["upserted"] == 1
            assert second["upserted"] == 1
            assert rows == 1
            assert row["local_match_id"] == "M089"
            assert row["status"] == "completed"
            assert row["home_score"] == 1
            assert row["away_score"] == 2
        finally:
            store.close()


def test_existing_fixture_match_uses_teams_or_unique_time() -> None:
    match = parse_sofascore_event(sample_event())
    fixtures = [
        {
            "id": "M089",
            "home": "Paraguay",
            "away": "France",
            "stage": "round_of_16",
            "sortDate": match.kickoff_time_utc,
        }
    ]
    assert match_existing_fixture(match, fixtures) == "M089"


def test_bracket_slot_resolution() -> None:
    results = {89: ("France", "Paraguay"), 90: ("Morocco", "Canada")}
    assert resolve_bracket_slot("Winner Match 89", results) == "France"
    assert resolve_bracket_slot("Loser Match 90", results) == "Canada"
    assert resolve_bracket_slot("Winner Match 97", results) == "Winner Match 97"


def test_export_live_fixture_keeps_m_number() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "sync.sqlite"
        output = Path(tmp) / "live-fixtures.json"
        output.write_text(
            json.dumps(
                {
                    "fixtures": [
                        {
                            "id": "M089",
                            "matchNumber": 89,
                            "stage": "round_of_16",
                            "group": "A",
                            "dateLabel": "cached",
                            "sortDate": "2026-07-04T21:00:00.000Z",
                            "home": "Winner Match 74",
                            "away": "Winner Match 77",
                            "venue": "Philadelphia",
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        store = LocalSqliteStore(str(db))
        store.local_fixtures = [
            {
                "id": "M089",
                "home": "Paraguay",
                "away": "France",
                "stage": "round_of_16",
                "sortDate": "2026-07-04T21:00:00.000Z",
            }
        ]
        store.migrate()
        try:
            run_sync(store, [sample_event()])
            export_live_fixtures(store, str(output))
            fixture = json.loads(output.read_text(encoding="utf-8"))["fixtures"][0]
            assert fixture["id"] == "M089"
            assert fixture["home"] == "Paraguay"
            assert fixture["away"] == "France"
        finally:
            store.close()


if __name__ == "__main__":
    test_parse_sofascore_event()
    test_parse_the_odds_api_event()
    test_penalty_score_is_separate()
    test_status_and_stage_mapping()
    test_local_upsert_is_idempotent_and_updates_score()
    test_existing_fixture_match_uses_teams_or_unique_time()
    test_bracket_slot_resolution()
    test_export_live_fixture_keeps_m_number()
    print("worldcup-sync service tests ok")
