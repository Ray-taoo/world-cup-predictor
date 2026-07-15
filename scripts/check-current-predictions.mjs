import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import generated from "../src/data/generated-data.json" with { type: "json" };
import live from "../src/data/live-fixtures.json" with { type: "json" };

const reportPath = path.join(process.cwd(), ".local", "trade-report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const fixtures = new Map(generated.fixtures.map((match) => [match.id, match]));
for (const match of live.fixtures ?? []) fixtures.set(match.id, match);
const now = Date.now();
const pendingIds = new Set((report.pendingResults ?? []).map((item) => item.matchId));
const currentIds = new Set((report.current ?? []).map((item) => item.matchId));
const overrideIds = new Set(report.completedMatchIds ?? []);

for (const item of report.current ?? []) {
  const match = fixtures.get(item.matchId);
  assert.ok(match, `unknown current match ${item.matchId}`);
  assert.ok(new Date(match.sortDate).getTime() > now, `${item.matchId} has already kicked off but is still in current predictions`);
}

for (const match of fixtures.values()) {
  if (new Date(match.sortDate).getTime() > now || overrideIds.has(match.id)) continue;
  assert.ok(!currentIds.has(match.id), `${match.id} has kicked off and must not be current`);
  assert.ok(pendingIds.has(match.id), `${match.id} has kicked off without a result but is missing from pendingResults`);
}

console.log("current predictions timing ok");
