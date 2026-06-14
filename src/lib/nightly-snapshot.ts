import fs from "node:fs";
import path from "node:path";
import type { OddsQuote } from "@/lib/types";
import type { NightlyRefreshState } from "@/lib/nightly-refresh";

const snapshotPath = path.join(process.cwd(), "src", "data", "nightly-snapshot.json");

interface NightlySnapshot {
  generatedAt: string | null;
  state: NightlyRefreshState;
  odds: OddsQuote[];
}

export function readNightlySnapshot(): NightlySnapshot | null {
  try {
    if (!fs.existsSync(snapshotPath)) return null;
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as NightlySnapshot;
    if (!snapshot || !Array.isArray(snapshot.odds)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function readNightlySnapshotOdds(): OddsQuote[] {
  return readNightlySnapshot()?.odds ?? [];
}
