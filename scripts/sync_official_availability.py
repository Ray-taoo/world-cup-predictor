from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import ssl
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import certifi
from pypdf import PdfReader


PAGE_API = "https://cxm-api.fifa.com/fifaplusweb/api/pages/en/tournaments/mens/worldcup/canadamexicousa2026/articles/disciplinary-previews-2026"
API_BASE = "https://cxm-api.fifa.com/fifaplusweb/api/"
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "worldcup-predictor/1.0"})
    with urllib.request.urlopen(request, timeout=20, context=SSL_CONTEXT) as response:
        return response.read()


def parse_report(text: str, source_url: str, fetched_at: str) -> tuple[str, str | None, list[dict[str, str]]]:
    report_match = re.search(r"Matches on (\d{2})\.(\d{2})\.(\d{4})", text)
    if not report_match:
        raise ValueError("report date missing")
    report_date = f"{report_match.group(3)}-{report_match.group(2)}-{report_match.group(1)}"
    created_match = re.search(r"created:\s*(\d{2})\.(\d{2})\.(\d{4})", text, re.I)
    published_at = None if not created_match else f"{created_match.group(3)}-{created_match.group(2)}-{created_match.group(1)}T00:00:00Z"
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    records: list[dict[str, str]] = []
    for index, value in enumerate(lines):
        if value != "Suspended":
            continue
        if index + 6 >= len(lines):
            raise ValueError("incomplete suspension row")
        team_match = re.fullmatch(r"(.+?)\s*\(([A-Z]{3})\)", lines[index + 1])
        if not team_match:
            raise ValueError("suspension team missing")
        player_name = lines[index + 2]
        key = hashlib.sha256(f"{report_date}|{team_match.group(1)}|{player_name}|suspension".encode()).hexdigest()
        records.append({
            "report_key": key,
            "report_date": report_date,
            "team_name": team_match.group(1),
            "player_name": player_name,
            "availability_type": "suspension",
            "status": value,
            "sanction": lines[index + 6],
            "source_url": source_url,
            "source_published_at": published_at,
            "fetched_at": fetched_at,
            "confirmation_status": "confirmed",
        })
    return report_date, published_at, records


def sql(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def source_upsert(source_key: str, report_date: str | None, source_url: str, published_at: str | None,
                  fetched_at: str, status: str, record_count: int, error: str | None) -> str:
    values = [source_key, report_date, source_url, published_at, fetched_at, status, record_count, error]
    return (
        "INSERT INTO official_availability_sync (source_key,report_date,source_url,source_published_at,fetched_at,status,record_count,error) "
        f"VALUES ({','.join(sql(value) for value in values)}) ON CONFLICT(source_key) DO UPDATE SET "
        "report_date=excluded.report_date,source_url=excluded.source_url,source_published_at=excluded.source_published_at,"
        "fetched_at=excluded.fetched_at,status=excluded.status,record_count=excluded.record_count,error=excluded.error;"
    )


def build_sql(today: date) -> tuple[str, dict[str, object]]:
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    statements: list[str] = []
    summary: dict[str, object] = {"fetchedAt": fetched_at, "documents": 0, "records": 0, "errors": []}
    try:
        page = json.loads(fetch(PAGE_API))
        section = next(item for item in page["sections"] if item["entryType"] == "sectionPromoCarousel")
        catalog_url = urljoin(API_BASE, section["entryEndpoint"].lstrip("/"))
        catalog = json.loads(fetch(catalog_url))
    except Exception as error:
        message = str(error)[:500]
        statements.append(source_upsert("fifa-disciplinary:catalog", None, PAGE_API, None, fetched_at, "error", 0, message))
        summary["errors"] = [message]
        return "\n".join(statements) + "\n", summary

    for item in catalog.get("items", []):
        date_match = re.search(r"([A-Z][a-z]+) (\d{1,2}) (\d{4})$", item.get("title", ""))
        if not date_match:
            continue
        report_day = datetime.strptime(" ".join(date_match.groups()), "%B %d %Y").date()
        if report_day < today:
            continue
        source_url = item["readMorePageUrl"]
        source_key = f"fifa-disciplinary:{report_day.isoformat()}"
        try:
            text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(fetch(source_url))).pages)
            report_date, published_at, records = parse_report(text, source_url, fetched_at)
            statements.append(f"UPDATE official_availability_reports SET active=0 WHERE report_date={sql(report_date)};")
            for record in records:
                columns = list(record) + ["active"]
                values = list(record.values()) + [1]
                statements.append(
                    f"INSERT INTO official_availability_reports ({','.join(columns)}) VALUES ({','.join(sql(value) for value in values)}) "
                    "ON CONFLICT(report_key) DO UPDATE SET status=excluded.status,sanction=excluded.sanction,source_url=excluded.source_url,"
                    "source_published_at=excluded.source_published_at,fetched_at=excluded.fetched_at,confirmation_status=excluded.confirmation_status,active=1;"
                )
            statements.append(source_upsert(source_key, report_date, source_url, published_at, fetched_at, "ok", len(records), None))
            summary["documents"] = int(summary["documents"]) + 1
            summary["records"] = int(summary["records"]) + len(records)
        except Exception as error:
            message = str(error)[:500]
            statements.append(source_upsert(source_key, report_day.isoformat(), source_url, None, fetched_at, "error", 0, message))
            summary["errors"].append(message)
    return "\n".join(statements) + "\n", summary


def self_test() -> None:
    sample = """Disciplinary Preview for Matches on 15.07.2026\nSuspended\nEngland (ENG)\nQUANSAH Jarell\nENG\n26\nPlayer\n2 Matches\ncreated: 12.07.2026"""
    report_date, published_at, records = parse_report(sample, "https://example.test/report.pdf", "2026-07-16T00:00:00Z")
    assert report_date == "2026-07-15" and published_at == "2026-07-12T00:00:00Z"
    assert records[0]["team_name"] == "England" and records[0]["sanction"] == "2 Matches"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        print("official availability parser ok")
        return 0
    if not args.output:
        parser.error("--output is required")
    payload, summary = build_sql(datetime.now(timezone.utc).date())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(payload, encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
