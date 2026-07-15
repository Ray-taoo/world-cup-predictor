import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const reportPath = path.join(process.cwd(), ".local", "trade-report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

for (const item of report.current ?? []) {
  for (const row of item.topScorelines ?? []) {
    assert.equal(outcome(row.score), item.side, `${item.matchId} ${row.score} does not match ${item.side}`);
  }
}

console.log("scoreline directions ok");

function outcome(score) {
  const [home, away] = score.split("-").map(Number);
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}
