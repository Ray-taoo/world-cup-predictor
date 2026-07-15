from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SOFASCORE_API = "https://api.sofascore.com/api/v1"
SOFASCORE_TOURNAMENT_ID = 16
SOFASCORE_SEASON_ID = 58210
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
THE_ODDS_API = "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds"
WORLD_CUP_START = date(2026, 6, 11)
WORLD_CUP_END = date(2026, 7, 19)
USER_AGENT = "worldcup-predictor-sync/2.0 (+local development)"
LAST_FETCH_ERRORS: list[str] = []


@dataclass
class SyncMatch:
    external_provider: str
    external_event_id: str
    kickoff_time_utc: str | None
    stage: str
    external_stage_raw: str | None
    status: str
    home_team_id: str | None
    away_team_id: str | None
    home_team_name: str
    away_team_name: str
    home_score: int | None
    away_score: int | None
    home_shootout_score: int | None
    away_shootout_score: int | None
    winner_team_id: str | None
    winner_team_name: str | None
    venue: str | None
    raw_event_json: str


class LocalSqliteStore:
    def __init__(self, db_path: str = ".local/worldcup-sync.sqlite") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.local_fixtures = load_local_fixtures()

    def close(self) -> None:
        self.conn.close()

    def migrate(self) -> None:
        migration = Path("workers/worldcup-sync/migrations/0001_worldcup_sync.sql").read_text(encoding="utf-8")
        self.conn.executescript(migration)
        ensure_column(self.conn, "sync_runs", "failed_dates", "INTEGER NOT NULL DEFAULT 0")
        self.conn.commit()

    def upsert_match(self, match: SyncMatch) -> str:
        external_row = self.conn.execute(
            "SELECT id, local_match_id, result_finalized_at FROM matches WHERE external_provider=? AND external_event_id=?",
            (match.external_provider, match.external_event_id),
        ).fetchone()
        local_match_id = (
            str(external_row["local_match_id"])
            if external_row
            else match_existing_fixture(match, self.local_fixtures) or next_match_id(self.conn)
        )
        local_row = self.conn.execute(
            "SELECT id, result_finalized_at FROM matches WHERE local_match_id=?",
            (local_match_id,),
        ).fetchone()
        now = datetime.now(timezone.utc).isoformat()
        finalized = (
            now
            if match.status == "completed" and match.home_score is not None and match.away_score is not None
            else None
        )
        row = asdict(match) | {
            "local_match_id": local_match_id,
            "result_finalized_at": finalized,
            "updated_at": now,
        }

        if local_row and (not external_row or int(local_row["id"]) != int(external_row["id"])):
            # A previous source may already own Mxxx. Convert that canonical row to the
            # current provider instead of creating a second match or failing UNIQUE(local_match_id).
            self.conn.execute(
                """
                UPDATE matches SET
                  external_provider=:external_provider,
                  external_event_id=:external_event_id,
                  kickoff_time_utc=:kickoff_time_utc,
                  stage=:stage,
                  external_stage_raw=:external_stage_raw,
                  status=:status,
                  home_team_id=:home_team_id,
                  away_team_id=:away_team_id,
                  home_team_name=:home_team_name,
                  away_team_name=:away_team_name,
                  home_score=COALESCE(:home_score, home_score),
                  away_score=COALESCE(:away_score, away_score),
                  home_shootout_score=COALESCE(:home_shootout_score, home_shootout_score),
                  away_shootout_score=COALESCE(:away_shootout_score, away_shootout_score),
                  winner_team_id=COALESCE(:winner_team_id, winner_team_id),
                  winner_team_name=COALESCE(:winner_team_name, winner_team_name),
                  venue=COALESCE(:venue, venue),
                  result_finalized_at=COALESCE(result_finalized_at, :result_finalized_at),
                  raw_event_json=:raw_event_json,
                  updated_at=:updated_at
                WHERE local_match_id=:local_match_id
                """,
                row,
            )
        else:
            self.conn.execute(
                """
                INSERT INTO matches (
                  external_provider, external_event_id, local_match_id, kickoff_time_utc, stage,
                  external_stage_raw, status, home_team_id, away_team_id, home_team_name, away_team_name,
                  home_score, away_score, home_shootout_score, away_shootout_score, winner_team_id,
                  winner_team_name, venue, result_finalized_at, raw_event_json, updated_at
                ) VALUES (
                  :external_provider, :external_event_id, :local_match_id, :kickoff_time_utc, :stage,
                  :external_stage_raw, :status, :home_team_id, :away_team_id, :home_team_name, :away_team_name,
                  :home_score, :away_score, :home_shootout_score, :away_shootout_score, :winner_team_id,
                  :winner_team_name, :venue, :result_finalized_at, :raw_event_json, :updated_at
                )
                ON CONFLICT(external_provider, external_event_id) DO UPDATE SET
                  local_match_id=excluded.local_match_id,
                  kickoff_time_utc=excluded.kickoff_time_utc,
                  stage=excluded.stage,
                  external_stage_raw=excluded.external_stage_raw,
                  status=excluded.status,
                  home_team_id=COALESCE(excluded.home_team_id, matches.home_team_id),
                  away_team_id=COALESCE(excluded.away_team_id, matches.away_team_id),
                  home_team_name=CASE WHEN excluded.home_team_name != 'TBD' THEN excluded.home_team_name ELSE matches.home_team_name END,
                  away_team_name=CASE WHEN excluded.away_team_name != 'TBD' THEN excluded.away_team_name ELSE matches.away_team_name END,
                  home_score=COALESCE(excluded.home_score, matches.home_score),
                  away_score=COALESCE(excluded.away_score, matches.away_score),
                  home_shootout_score=COALESCE(excluded.home_shootout_score, matches.home_shootout_score),
                  away_shootout_score=COALESCE(excluded.away_shootout_score, matches.away_shootout_score),
                  winner_team_id=COALESCE(excluded.winner_team_id, matches.winner_team_id),
                  winner_team_name=COALESCE(excluded.winner_team_name, matches.winner_team_name),
                  venue=COALESCE(excluded.venue, matches.venue),
                  result_finalized_at=COALESCE(matches.result_finalized_at, excluded.result_finalized_at),
                  raw_event_json=excluded.raw_event_json,
                  updated_at=excluded.updated_at
                """,
                row,
            )
        self.conn.commit()
        return local_match_id


def http_get_json(url: str, timeout: int = 20) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/plain,*/*",
                    "Accept-Language": "en-US,en;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("JSON root is not an object")
                return payload
        except Exception as exc:  # noqa: BLE001 - retries are deliberate at the source boundary.
            last_error = exc
            time.sleep(0.6 * (2**attempt))
    raise RuntimeError(f"GET {url} failed: {last_error}")


def http_get_json_array(url: str, timeout: int = 20) -> list[Any]:
    last_error: Exception | None = None
    safe_url = url.split("apiKey=", 1)[0] + "apiKey=<redacted>" if "apiKey=" in url else url
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/plain,*/*",
                    "Accept-Language": "en-US,en;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, list):
                    raise ValueError("JSON root is not an array")
                return payload
        except Exception as exc:  # noqa: BLE001 - retries are deliberate at the source boundary.
            last_error = exc
            time.sleep(0.6 * (2**attempt))
    raise RuntimeError(f"GET {safe_url} failed: {last_error}")


def fetch_sofascore_page(direction: str, page: int) -> dict[str, Any]:
    if direction not in {"last", "next"}:
        raise ValueError("direction must be last or next")
    url = (
        f"{SOFASCORE_API}/unique-tournament/{SOFASCORE_TOURNAMENT_ID}"
        f"/season/{SOFASCORE_SEASON_ID}/events/{direction}/{page}"
    )
    return http_get_json(url)


def fetch_sofascore_events(full: bool) -> list[dict[str, Any]]:
    LAST_FETCH_ERRORS.clear()
    directions = ("last", "next")
    max_pages = 8 if full else 1
    by_id: dict[str, dict[str, Any]] = {}
    for direction in directions:
        for page in range(max_pages):
            try:
                payload = fetch_sofascore_page(direction, page)
            except RuntimeError as exc:
                LAST_FETCH_ERRORS.append(str(exc))
                break
            events = payload.get("events") or []
            if not isinstance(events, list):
                LAST_FETCH_ERRORS.append(f"Sofascore {direction}/{page}: events is not an array")
                break
            for event in events:
                if isinstance(event, dict) and event.get("id") is not None:
                    by_id[str(event["id"])] = event
            if not payload.get("hasNextPage"):
                break
    return sorted(by_id.values(), key=lambda event: int(event.get("startTimestamp") or 0))


def fetch_the_odds_api_events() -> list[dict[str, Any]]:
    api_key = env_value("ODDS_API_KEY")
    if not api_key:
        LAST_FETCH_ERRORS.append("The Odds API fallback skipped: ODDS_API_KEY is not configured")
        return []
    url = f"{THE_ODDS_API}?regions=eu&markets=h2h&oddsFormat=decimal&apiKey={api_key}"
    return [event for event in http_get_json_array(url) if isinstance(event, dict)]


def fetch_scoreboard_for_date(day: date) -> dict[str, Any]:
    """Legacy ESPN fallback kept only for environments where it works."""
    url = f"{ESPN_SCOREBOARD}?dates={day:%Y%m%d}&limit=200"
    return http_get_json(url)


def fetch_espn_recent_events(today: date | None = None) -> list[dict[str, Any]]:
    today = today or datetime.now(timezone.utc).date()
    events: list[dict[str, Any]] = []
    for offset in range(-2, 3):
        day = today + timedelta(days=offset)
        try:
            events.extend(fetch_scoreboard_for_date(day).get("events") or [])
        except RuntimeError as exc:
            LAST_FETCH_ERRORS.append(str(exc))
    return events


def parse_sofascore_event(event: dict[str, Any]) -> SyncMatch:
    home = event.get("homeTeam") or {}
    away = event.get("awayTeam") or {}
    home_score_obj = event.get("homeScore") or {}
    away_score_obj = event.get("awayScore") or {}
    status_obj = event.get("status") or {}
    winner_code = parse_int(event.get("winnerCode"))
    home_name = canonical_team_name(home.get("name") or home.get("shortName") or "TBD")
    away_name = canonical_team_name(away.get("name") or away.get("shortName") or "TBD")
    winner = home if winner_code == 1 else away if winner_code == 2 else {}
    stage_raw_value = sofascore_stage_raw(event)
    kickoff = timestamp_to_utc(event.get("startTimestamp"))
    return SyncMatch(
        external_provider="sofascore",
        external_event_id=str(event.get("id") or ""),
        kickoff_time_utc=kickoff,
        stage=map_stage_text(stage_raw_value, kickoff),
        external_stage_raw=stage_raw_value or None,
        status=map_sofascore_status(status_obj),
        home_team_id=string_or_none(home.get("id")),
        away_team_id=string_or_none(away.get("id")),
        home_team_name=home_name,
        away_team_name=away_name,
        home_score=best_score(home_score_obj),
        away_score=best_score(away_score_obj),
        home_shootout_score=parse_int(home_score_obj.get("penalties")),
        away_shootout_score=parse_int(away_score_obj.get("penalties")),
        winner_team_id=string_or_none(winner.get("id")),
        winner_team_name=canonical_team_name(winner.get("name") or winner.get("shortName")) if winner else None,
        venue=sofascore_venue(event),
        raw_event_json=json.dumps(event, separators=(",", ":"), ensure_ascii=False),
    )


def parse_the_odds_api_event(event: dict[str, Any]) -> SyncMatch:
    kickoff = parse_utc(event.get("commence_time"))
    return SyncMatch(
        external_provider="the_odds_api",
        external_event_id=str(event.get("id") or ""),
        kickoff_time_utc=kickoff,
        stage=map_stage_text("Round of 16", kickoff),
        external_stage_raw="The Odds API h2h event",
        status="scheduled",
        home_team_id=None,
        away_team_id=None,
        home_team_name=canonical_team_name(event.get("home_team") or "TBD"),
        away_team_name=canonical_team_name(event.get("away_team") or "TBD"),
        home_score=None,
        away_score=None,
        home_shootout_score=None,
        away_shootout_score=None,
        winner_team_id=None,
        winner_team_name=None,
        venue=None,
        raw_event_json=json.dumps(event, separators=(",", ":"), ensure_ascii=False),
    )


def parse_espn_event(event: dict[str, Any]) -> SyncMatch:
    competitors = (((event.get("competitions") or [{}])[0]).get("competitors") or [])
    home = competitor_by_home_away(competitors, "home")
    away = competitor_by_home_away(competitors, "away")
    status_obj = ((event.get("status") or {}).get("type") or {})
    competition = (event.get("competitions") or [{}])[0]
    winner = home if truthy(home.get("winner")) else away if truthy(away.get("winner")) else {}
    return SyncMatch(
        external_provider="espn",
        external_event_id=str(event.get("id") or ""),
        kickoff_time_utc=parse_utc(event.get("date")),
        stage=map_match_stage(event),
        external_stage_raw=stage_raw(event),
        status=map_match_status(status_obj),
        home_team_id=team_id(home),
        away_team_id=team_id(away),
        home_team_name=canonical_team_name(team_name(home)),
        away_team_name=canonical_team_name(team_name(away)),
        home_score=parse_int(home.get("score")),
        away_score=parse_int(away.get("score")),
        home_shootout_score=parse_int(home.get("shootoutScore")),
        away_shootout_score=parse_int(away.get("shootoutScore")),
        winner_team_id=team_id(winner),
        winner_team_name=canonical_team_name(team_name(winner)) if winner else None,
        venue=((competition.get("venue") or {}).get("fullName")),
        raw_event_json=json.dumps(event, separators=(",", ":"), ensure_ascii=False),
    )


def map_sofascore_status(status_obj: dict[str, Any]) -> str:
    kind = str(status_obj.get("type") or status_obj.get("description") or "").lower()
    code = parse_int(status_obj.get("code"))
    if kind in {"finished", "afterextra", "afterpenalties"} or code == 100:
        return "completed"
    if "postpon" in kind:
        return "postponed"
    if "cancel" in kind:
        return "cancelled"
    if "abandon" in kind or "interrupt" in kind:
        return "abandoned"
    if kind in {"inprogress", "live", "1st", "2nd", "extra", "penalties"} or (code is not None and 0 < code < 100):
        return "halftime" if "half" in kind else "in_progress"
    if kind in {"notstarted", "scheduled"} or code == 0:
        return "scheduled"
    return "unknown"


def map_match_status(status_obj: dict[str, Any]) -> str:
    if status_obj.get("completed") is True or status_obj.get("state") == "post":
        return "completed"
    name = str(status_obj.get("name") or status_obj.get("description") or "").lower()
    state = str(status_obj.get("state") or "").lower()
    if "postpon" in name:
        return "postponed"
    if "cancel" in name:
        return "cancelled"
    if "abandon" in name:
        return "abandoned"
    if state == "in" or "half" in name:
        return "halftime" if "half" in name else "in_progress"
    if state == "pre":
        return "scheduled"
    return "unknown"


def map_match_stage(event: dict[str, Any]) -> str:
    return map_stage_text(stage_raw(event), parse_utc(event.get("date")))


def map_stage_text(text: str, kickoff_time_utc: str | None = None) -> str:
    normalized = str(text or "").lower()
    if "group" in normalized:
        return "GROUP_STAGE"
    if "round of 32" in normalized or "1/16" in normalized:
        return "ROUND_OF_32"
    if "round of 16" in normalized or "1/8" in normalized:
        return "ROUND_OF_16"
    if "quarter" in normalized or "1/4" in normalized:
        return "QUARTER_FINAL"
    if "semi" in normalized:
        return "SEMI_FINAL"
    if "third" in normalized or "3rd place" in normalized:
        return "THIRD_PLACE"
    if normalized.strip() == "final" or "world cup final" in normalized:
        return "FINAL"
    if kickoff_time_utc:
        day = datetime.fromisoformat(kickoff_time_utc).astimezone(timezone.utc).date()
        if day <= date(2026, 6, 27):
            return "GROUP_STAGE"
        if day <= date(2026, 7, 3):
            return "ROUND_OF_32"
        if day <= date(2026, 7, 7):
            return "ROUND_OF_16"
        if day <= date(2026, 7, 11):
            return "QUARTER_FINAL"
        if day <= date(2026, 7, 15):
            return "SEMI_FINAL"
        if day == date(2026, 7, 18):
            return "THIRD_PLACE"
        if day == date(2026, 7, 19):
            return "FINAL"
    return "UNKNOWN"


def run_full_sync(store: LocalSqliteStore) -> dict[str, Any]:
    return run_provider_sync(store, full=True)


def run_recent_sync(store: LocalSqliteStore) -> dict[str, Any]:
    return run_provider_sync(store, full=False)


def run_provider_sync(store: LocalSqliteStore, full: bool) -> dict[str, Any]:
    events = fetch_sofascore_events(full=full)
    source = "sofascore"
    parser = parse_sofascore_event
    if not events and LAST_FETCH_ERRORS:
        events = fetch_the_odds_api_events()
        if events:
            source = "the_odds_api"
            parser = parse_the_odds_api_event
    summary = run_sync(store, events, parser=parser)
    summary["source"] = source
    summary["failed_dates"] = len(LAST_FETCH_ERRORS)
    summary["error"] = "\n".join(LAST_FETCH_ERRORS[:8])
    export_live_fixtures(store, source_label=source)
    return summary


def run_sync(
    store: LocalSqliteStore,
    events: list[dict[str, Any]],
    parser=parse_sofascore_event,
) -> dict[str, int]:
    summary = {"events": len(events), "upserted": 0, "completed": 0, "unknown_stage": 0, "tbd": 0}
    for event in events:
        match = parser(event)
        if not match.external_event_id:
            continue
        store.upsert_match(match)
        summary["upserted"] += 1
        summary["completed"] += int(
            match.status == "completed" and match.home_score is not None and match.away_score is not None
        )
        summary["unknown_stage"] += int(match.stage == "UNKNOWN")
        summary["tbd"] += int(is_placeholder_team(match.home_team_name) or is_placeholder_team(match.away_team_name))
    return summary


def export_live_fixtures(
    store: LocalSqliteStore,
    output_path: str = "src/data/live-fixtures.json",
    source_label: str = "cached schedule",
) -> None:
    path = Path(output_path)
    existing: dict[str, Any] = {"updatedAt": None, "source": "cached schedule", "fixtures": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except Exception:
            pass
    by_id = {str(item.get("id")): dict(item) for item in existing.get("fixtures") or [] if item.get("id")}
    rows = store.conn.execute(
        """
        SELECT local_match_id, kickoff_time_utc, stage, status, home_team_name, away_team_name, venue,
               winner_team_name, external_provider, updated_at
        FROM matches
        WHERE local_match_id LIKE 'M%'
        ORDER BY CAST(SUBSTR(local_match_id, 2) AS INTEGER)
        """
    ).fetchall()
    result_teams: dict[int, tuple[str | None, str | None]] = {}
    for result_row in rows:
        local_id = str(result_row["local_match_id"])
        if not local_id[1:].isdigit() or str(result_row["status"]) != "completed":
            continue
        winner = canonical_team_name(result_row["winner_team_name"]) if result_row["winner_team_name"] else None
        home = canonical_team_name(result_row["home_team_name"])
        away = canonical_team_name(result_row["away_team_name"])
        loser = None
        if winner and normalize_team(winner) == normalize_team(home):
            loser = away
        elif winner and normalize_team(winner) == normalize_team(away):
            loser = home
        result_teams[int(local_id[1:])] = (winner, loser)

    for row in rows:
        match_id = str(row["local_match_id"])
        number = int(match_id[1:]) if match_id[1:].isdigit() else 0
        if number < 89 or number > 104:
            continue
        current = by_id.get(match_id, fixture_shell(number))
        home = canonical_team_name(row["home_team_name"])
        away = canonical_team_name(row["away_team_name"])
        if not is_placeholder_team(home):
            current["home"] = home
        if not is_placeholder_team(away):
            current["away"] = away
        current["home"] = resolve_bracket_slot(str(current.get("home") or "TBD"), result_teams)
        current["away"] = resolve_bracket_slot(str(current.get("away") or "TBD"), result_teams)
        if row["kickoff_time_utc"]:
            current["sortDate"] = iso_z(str(row["kickoff_time_utc"]))
            current["dateLabel"] = date_label(str(row["kickoff_time_utc"]))
        if row["venue"]:
            current["venue"] = str(row["venue"])
        current["stage"] = stage_to_fixture_stage(str(row["stage"]), number)
        by_id[match_id] = current
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": f"{source_label} with cached knockout schedule",
        "fixtures": sorted(by_id.values(), key=lambda item: int(item.get("matchNumber") or 0)),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, path)



def resolve_bracket_slot(value: str, result_teams: dict[int, tuple[str | None, str | None]]) -> str:
    normalized = value.strip()
    lower = normalized.lower()
    for prefix, index in (("winner match ", 0), ("loser match ", 1)):
        if lower.startswith(prefix):
            number_text = lower.removeprefix(prefix).strip()
            if number_text.isdigit():
                resolved = result_teams.get(int(number_text), (None, None))[index]
                if resolved:
                    return resolved
    return normalized

def fixture_shell(number: int) -> dict[str, Any]:
    stage = stage_for_match_number(number)
    return {
        "id": f"M{number:03d}",
        "matchNumber": number,
        "stage": stage,
        "group": "A",
        "dateLabel": "待赛程同步",
        "sortDate": "2026-07-19T23:59:00.000Z",
        "home": "TBD",
        "away": "TBD",
        "venue": "TBD",
    }


def stage_for_match_number(number: int) -> str:
    if number <= 72:
        return "group"
    if number <= 88:
        return "round_of_32"
    if number <= 96:
        return "round_of_16"
    if number <= 100:
        return "quarter_final"
    if number <= 102:
        return "semi_final"
    if number == 103:
        return "third_place"
    return "final"


def stage_to_fixture_stage(stage: str, number: int) -> str:
    mapping = {
        "GROUP_STAGE": "group",
        "ROUND_OF_32": "round_of_32",
        "ROUND_OF_16": "round_of_16",
        "QUARTER_FINAL": "quarter_final",
        "SEMI_FINAL": "semi_final",
        "THIRD_PLACE": "third_place",
        "FINAL": "final",
    }
    return mapping.get(stage, stage_for_match_number(number))


def competitor_by_home_away(competitors: list[dict[str, Any]], side: str) -> dict[str, Any]:
    for competitor in competitors:
        if competitor.get("homeAway") == side:
            return competitor
    return {}


def team_id(competitor: dict[str, Any]) -> str | None:
    value = (competitor.get("team") or {}).get("id") or competitor.get("id")
    return str(value) if value is not None else None


def team_name(competitor: dict[str, Any]) -> str:
    team = competitor.get("team") or {}
    return str(team.get("displayName") or team.get("shortDisplayName") or "TBD")


def parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def string_or_none(value: Any) -> str | None:
    return None if value in (None, "") else str(value)


def parse_utc(value: Any) -> str | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()


def env_value(key: str) -> str | None:
    value = os.environ.get(key)
    if value:
        return value.strip()
    path = Path(".env.local")
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def timestamp_to_utc(value: Any) -> str | None:
    timestamp = parse_int(value)
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def truthy(value: Any) -> bool:
    return value is True or str(value).lower() == "true"


def best_score(score_obj: dict[str, Any]) -> int | None:
    for key in ("current", "overtime", "normaltime", "display", "period2"):
        parsed = parse_int(score_obj.get(key))
        if parsed is not None:
            return parsed
    return None


def sofascore_stage_raw(event: dict[str, Any]) -> str:
    round_info = event.get("roundInfo") or {}
    tournament = event.get("tournament") or {}
    parts = [
        round_info.get("name"),
        round_info.get("slug"),
        tournament.get("name"),
        event.get("customId"),
    ]
    return " ".join(str(value) for value in parts if value)


def sofascore_venue(event: dict[str, Any]) -> str | None:
    venue = event.get("venue") or {}
    stadium = venue.get("stadium") or {}
    city = venue.get("city") or {}
    name = venue.get("name") or stadium.get("name")
    city_name = city.get("name")
    if name and city_name and city_name.lower() not in str(name).lower():
        return f"{name}, {city_name}"
    return str(name or city_name) if (name or city_name) else None


def stage_raw(event: dict[str, Any]) -> str:
    competition = (event.get("competitions") or [{}])[0]
    parts = [
        event.get("name"),
        event.get("shortName"),
        (competition.get("type") or {}).get("text"),
        " ".join(str(note.get("headline") or note.get("type") or "") for note in competition.get("notes") or []),
    ]
    return " ".join(str(part) for part in parts if part)


def next_match_id(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        "SELECT local_match_id FROM matches WHERE local_match_id LIKE 'E%' ORDER BY local_match_id DESC LIMIT 1"
    ).fetchone()
    current = int(str(row["local_match_id"])[1:]) if row else 0
    return f"E{current + 1:03d}"


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def load_local_fixtures() -> list[dict[str, Any]]:
    fixtures: list[dict[str, Any]] = []
    generated_path = Path("src/data/generated-data.json")
    live_path = Path("src/data/live-fixtures.json")
    try:
        fixtures.extend(json.loads(generated_path.read_text(encoding="utf-8")).get("fixtures") or [])
    except Exception:
        pass
    try:
        fixtures.extend(json.loads(live_path.read_text(encoding="utf-8")).get("fixtures") or [])
    except Exception:
        pass
    by_id = {str(fixture.get("id")): fixture for fixture in fixtures if fixture.get("id")}
    return list(by_id.values())


def match_existing_fixture(match: SyncMatch, fixtures: list[dict[str, Any]]) -> str | None:
    if not match.kickoff_time_utc:
        return None
    kickoff = datetime.fromisoformat(match.kickoff_time_utc).timestamp()
    team_candidates: list[str] = []
    time_candidates: list[str] = []
    for fixture in fixtures:
        try:
            fixture_time = datetime.fromisoformat(str(fixture.get("sortDate")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        delta = abs(fixture_time - kickoff)
        if delta <= 12 * 60 * 60 and teams_equal(fixture.get("home"), match.home_team_name) and teams_equal(
            fixture.get("away"), match.away_team_name
        ):
            team_candidates.append(str(fixture.get("id")))
        if delta <= 90 * 60 and str(fixture.get("stage")) != "group":
            time_candidates.append(str(fixture.get("id")))
    if len(team_candidates) == 1:
        return team_candidates[0]
    if len(time_candidates) == 1:
        return time_candidates[0]
    return None


def teams_equal(left: Any, right: Any) -> bool:
    if is_placeholder_team(left) or is_placeholder_team(right):
        return False
    return normalize_team(left) == normalize_team(right)


def normalize_team(value: Any) -> str:
    text = str(value or "").lower().replace("&", "and")
    text = " ".join("".join(ch if ch.isalnum() else " " for ch in text).split())
    aliases = {
        "united states": "usa",
        "united states of america": "usa",
        "us": "usa",
        "bosnia herzegovina": "bosnia and herzegovina",
        "bosnia and herzegovina": "bosnia and herzegovina",
        "cabo verde": "cape verde",
        "congo dr": "dr congo",
        "democratic republic of the congo": "dr congo",
        "cote d ivoire": "ivory coast",
        "côte d ivoire": "ivory coast",
        "korea republic": "south korea",
        "turkiye": "turkey",
        "czechia": "czech republic",
    }
    return aliases.get(text, text)


def canonical_team_name(value: Any) -> str:
    raw = str(value or "TBD").strip()
    normalized = normalize_team(raw)
    canonical = {
        "usa": "USA",
        "bosnia and herzegovina": "Bosnia & Herzegovina",
        "cape verde": "Cape Verde",
        "dr congo": "DR Congo",
        "ivory coast": "Ivory Coast",
        "south korea": "South Korea",
        "turkey": "Turkey",
        "czech republic": "Czech Republic",
        "curacao": "Curaçao",
    }
    return canonical.get(normalized, raw)


def is_placeholder_team(value: Any) -> bool:
    text = normalize_team(value)
    return (
        not text
        or text in {"tbd", "to be decided", "unknown"}
        or text.startswith("winner match")
        or text.startswith("loser match")
        or text.startswith("winner group")
        or text.startswith("runner up group")
        or text.startswith("3rd group")
    )


def iso_z(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def date_label(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    return parsed.strftime("%a %B %-d, %H:%M UTC") if os.name != "nt" else parsed.strftime("%a %B %#d, %H:%M UTC")
