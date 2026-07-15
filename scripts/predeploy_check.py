from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "workers/worldcup-sync/wrangler.jsonc",
    "workers/worldcup-sync/migrations/0001_worldcup_sync.sql",
    "workers/worldcup-sync/src/entry.py",
    "workers/worldcup-sync/src/worldcup_sync_service.py",
    "README_LOCAL.md",
    "DEPLOYMENT_PLAN.md",
]


def main() -> int:
    failures = [f"missing {item}" for item in REQUIRED if not (ROOT / item).exists()]
    if os.environ.get("CONFIRM_PUBLIC_DEPLOY") != "true":
        failures.append("CONFIRM_PUBLIC_DEPLOY=true is required before any public deploy")
    if os.environ.get("ALLOW_PRODUCTION_WRITES") != "true":
        failures.append("ALLOW_PRODUCTION_WRITES=true is required before production writes")
    for path in ROOT.rglob("*"):
        rel = path.relative_to(ROOT).as_posix()
        if path.is_file() and rel not in {".env.local", "scripts/predeploy_check.py"} and not rel.startswith("docs/agent/") and rel.endswith((".py", ".jsonc", ".md", ".toml")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            if "worldcup-predictor.coffee-warbler.workers.dev" in text and rel != "DEPLOYMENT_PLAN.md":
                failures.append(f"public worker url reference outside deployment docs: {rel}")
    if failures:
        print("predeploy blocked:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("predeploy check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
