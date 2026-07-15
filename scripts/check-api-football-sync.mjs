import assert from "node:assert/strict";
import { analysisStatus, mapStatus, nextRequestUsage } from "./sync-api-football-results.mjs";

assert.equal(mapStatus("NS"), "scheduled");
assert.equal(mapStatus("TBD"), "scheduled");
assert.equal(mapStatus("1H"), "in_progress");
assert.equal(mapStatus("HT"), "halftime");
assert.equal(mapStatus("2H"), "in_progress");
assert.equal(mapStatus("ET"), "in_progress");
assert.equal(mapStatus("BT"), "in_progress");
assert.equal(mapStatus("P"), "penalty_shootout");
assert.equal(mapStatus("FT"), "finished");
assert.equal(mapStatus("AET"), "finished_after_extra_time");
assert.equal(mapStatus("PEN"), "finished_after_penalties");
assert.equal(mapStatus("PST"), "postponed");
assert.equal(mapStatus("CANC"), "cancelled");
assert.equal(mapStatus("ABD"), "abandoned");
assert.equal(mapStatus("AWD"), "awarded");
assert.equal(mapStatus("WO"), "walkover");

assert.deepEqual(nextRequestUsage({}, "2026-07-03T00:00:00.000Z", 2), {
  requestDay: "2026-07-03",
  requestsUsedToday: 1,
  requestLimit: 2
});
assert.deepEqual(nextRequestUsage({ requestDay: "2026-07-03", requestsUsedToday: 1 }, "2026-07-03T01:00:00.000Z", 2), {
  requestDay: "2026-07-03",
  requestsUsedToday: 2,
  requestLimit: 2
});
assert.throws(
  () => nextRequestUsage({ requestDay: "2026-07-03", requestsUsedToday: 2 }, "2026-07-03T02:00:00.000Z", 2),
  /daily request guard/
);
assert.equal(nextRequestUsage({ requestDay: "2026-07-02", requestsUsedToday: 2 }, "2026-07-03T00:00:00.000Z", 2).requestsUsedToday, 1);

assert.equal(analysisStatus("finished", { home: 1, away: 0 }), "completed");
assert.equal(analysisStatus("finished_after_extra_time", { home: 2, away: 1 }), "completed");
assert.equal(analysisStatus("finished_after_penalties", { home: 1, away: 1 }), "completed");
assert.equal(analysisStatus("awarded", { home: 3, away: 0 }), "special");
assert.equal(analysisStatus("walkover", { home: 3, away: 0 }), "special");
assert.equal(analysisStatus("finished", { home: null, away: 0 }), "pending");
assert.equal(analysisStatus("postponed", { home: 0, away: 0 }), "pending");

console.log("api-football sync checks ok");
