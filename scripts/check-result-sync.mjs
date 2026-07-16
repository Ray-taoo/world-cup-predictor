import assert from "node:assert/strict";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { fifaArticleCandidates, mergeResults, normalTimeScoreIsUsable, normalizeResultStatus, parseArticleResult, parseTheScoreDetail, parseTheScoreEvent, parseTheScoreScheduleEvents, postMatchAnalysisStatus, reconcileNormalTimeScore, selectTheScoreEvent } from "./refresh-results.mjs";

const html = (scoreboard) => `<html><body>MATCHUP Demo FS1 ${scoreboard} Timeline</body></html>`;

assert.equal(normalizeResultStatus("Final"), "finished");
assert.equal(normalizeResultStatus("AET"), "finished_after_extra_time");
assert.equal(normalizeResultStatus("after penalties"), "finished_after_penalties");
assert.equal(normalizeResultStatus("postponed"), "postponed");
assert.equal(normalizeResultStatus("cancelled"), "cancelled");
assert.equal(normalizeResultStatus("awarded"), "awarded");
assert.equal(normalizeResultStatus("abandoned"), "abandoned");
assert.equal(normalizeResultStatus("live"), "in_progress");
assert.equal(normalizeResultStatus("halftime"), "halftime");

const regressionCases = [
  {
    label: "England vs DR Congo",
    scoreboard: "England 2-1-0, 1st Group L 2 Congo DR 1-1-1, 3rd Group K 1",
    match: { home: "England", away: "DR Congo" },
    score: { homeScore: 2, awayScore: 1 }
  },
  {
    label: "Belgium vs Senegal",
    scoreboard: "Belgium 3-0-0, 1st Group E 3 Senegal 1-1-1, 3rd Group A 2",
    match: { home: "Belgium", away: "Senegal" },
    score: { homeScore: 3, awayScore: 2 }
  },
  {
    label: "USA vs Bosnia",
    scoreboard: "United States 2-0-1, 1st Group D 2 Bosnia-Herzegovina 1-1-1, 3rd Group B 0",
    match: { home: "USA", away: "Bosnia & Herzegovina" },
    score: { homeScore: 2, awayScore: 0 }
  },
  {
    label: "Spain vs Austria",
    scoreboard: "Spain 2-1-0, 1st Group H 3 Austria 1-1-1, 2nd Group J 0",
    match: { home: "Spain", away: "Austria" },
    score: { homeScore: 3, awayScore: 0 }
  },
  {
    label: "Portugal vs Croatia",
    scoreboard: "Portugal 1-2-0, 2nd Group K 2 Croatia 2-0-1, 2nd Group L 1",
    match: { home: "Portugal", away: "Croatia" },
    score: { homeScore: 2, awayScore: 1 }
  }
];

for (const item of regressionCases) {
  assert.deepEqual(parseTheScoreEvent(html(item.scoreboard), item.match), item.score, item.label);
}

assert.equal(parseTheScoreEvent(html("England 2-1-0, 1st Group L Congo DR 1-1-1, 3rd Group K"), { home: "England", away: "DR Congo" }), null);
assert.equal(parseTheScoreEvent(html("Switzerland 2-1-0, 1st Group B Algeria 1-1-1, 3rd Group J"), { home: "Switzerland", away: "Algeria" }), null);
assert.equal(parseTheScoreEvent("<html>request timed out</html>", { home: "England", away: "DR Congo" }), null);
assert.deepEqual(
  parseArticleResult("World Cup 2026: Canada 0-3 Morocco as it happened", { home: "Canada", away: "Morocco" }),
  { homeScore: 0, awayScore: 3 }
);
assert.deepEqual(
  parseArticleResult("Kylian Mbappé made sure after France’s 1-0 win over Paraguay", { home: "Paraguay", away: "France" }),
  { homeScore: 0, awayScore: 1 }
);
assert.deepEqual(
  parseTheScoreScheduleEvents('selectedGroup\\":{\\"events\\":[{\\"__typename\\":\\"SoccerEvent\\",\\"id\\":\\"SoccerEvent:93020\\",\\"bareId\\":93020,\\"startsAt\\":\\"2026-07-04T17:00:00Z\\",\\"eventStatus\\":\\"FINAL\\",\\"homeTeam\\":{\\"__typename\\":\\"SoccerTeam\\",\\"name\\":\\"Canada\\"},\\"awayTeam\\":{\\"__typename\\":\\"SoccerTeam\\",\\"name\\":\\"Morocco\\"},\\"boxScore\\":{\\"__typename\\":\\"SoccerBoxScore\\",\\"homeScore\\":0,\\"awayScore\\":3,\\"progress\\":{\\"description\\":\\"Final\\",\\"clock\\":\\"90\' + 8\'\\",\\"segmentShort\\":\\"2nd\\"}}}]}'),
  [
    {
      externalMatchId: "93020",
      startsAt: "2026-07-04T17:00:00Z",
      status: "FINAL",
      home: "Canada",
      away: "Morocco",
      homeScore: 0,
      awayScore: 3,
      progressDescription: "Final",
      segmentShort: "2nd"
    }
  ]
);
const duplicateEventMatch = { home: "England", away: "Argentina", sortDate: "2026-07-15T19:00:00Z" };
const staleEvent = { home: "England", away: "Argentina", startsAt: "2026-07-15T19:00:00Z", status: "FINAL", progressDescription: null, segmentShort: null };
const finalEvent = { ...staleEvent, progressDescription: "Final", segmentShort: "2nd" };
assert.equal(selectTheScoreEvent([staleEvent, finalEvent], duplicateEventMatch), finalEvent);
assert.deepEqual(
  parseTheScoreDetail('\\"line_scores\\":{\\"home\\":[{\\"score\\":1,\\"segment_string\\":\\"1\\"},{\\"score\\":0,\\"segment_string\\":\\"2\\"},{\\"score\\":2,\\"segment_string\\":\\"ET2\\"},{\\"score\\":0,\\"segment_string\\":\\"ET1\\"}],\\"away\\":[{\\"score\\":0,\\"segment_string\\":\\"1\\"},{\\"score\\":1,\\"segment_string\\":\\"2\\"},{\\"score\\":0,\\"segment_string\\":\\"ET1\\"},{\\"score\\":0,\\"segment_string\\":\\"ET2\\"}]},\\"home_shootout_goals\\":null,\\"away_shootout_goals\\":null'),
  { normalTimeHomeScore: 1, normalTimeAwayScore: 1, extraTimeScore: "2-0", penaltyScore: null, matchStatus: "finished_after_extra_time" }
);
assert.equal(normalTimeScoreIsUsable({ matchStatus: "finished", homeScore: 1, awayScore: 2, normalTimeHomeScore: 0, normalTimeAwayScore: 0, extraTimeScore: null, penaltyScore: null }), false);
assert.equal(normalTimeScoreIsUsable({ matchStatus: "finished", homeScore: 1, awayScore: 2, normalTimeHomeScore: 1, normalTimeAwayScore: 2, extraTimeScore: null, penaltyScore: null }), true);
assert.deepEqual(
  reconcileNormalTimeScore({ matchStatus: "finished", homeScore: 1, awayScore: 2, normalTimeHomeScore: 0, normalTimeAwayScore: 0, extraTimeScore: null, penaltyScore: null }),
  { matchStatus: "finished", homeScore: 1, awayScore: 2, normalTimeHomeScore: 1, normalTimeAwayScore: 2, extraTimeScore: null, penaltyScore: null }
);
assert.equal(new Date("2026-06-30T17:00:00.000Z").toISOString(), "2026-06-30T17:00:00.000Z");
assert.deepEqual(
  mergeResults([
    { matchId: "M1", matchNumber: 1, homeScore: 1, awayScore: 0 },
    { matchId: "M1", matchNumber: 1, homeScore: 9, awayScore: 9 }
  ]).map((row) => `${row.matchId}:${row.homeScore}-${row.awayScore}`),
  ["M1:1-0"]
);
assert.equal(postMatchAnalysisStatus({ homeScore: 1, awayScore: 0 }, null), "completed");
assert.equal(postMatchAnalysisStatus({ homeScore: 1, awayScore: 0 }, new Error("review failed")), "pending");
assert.ok(fifaArticleCandidates({ home: "Paraguay", away: "France" }).includes("https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/paraguay-france-match-report-highlights"));
assert.ok(fifaArticleCandidates({ home: "Canada", away: "Morocco" }).includes("https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/canada-morocco-match-report-highlights"));
assert.match(fs.readFileSync("scripts/start-local-site.ps1", "utf8"), /refresh:results/);
assert.match(fs.readFileSync("scripts/start-local.mjs", "utf8"), /refresh-results\.mjs/);

if (fs.existsSync(".local/worldcup.sqlite")) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(".local/worldcup.sqlite"));
  const invalid = db.exec(`
    SELECT match_id FROM result_sync_status
    WHERE match_status = 'finished'
      AND extra_time_score IS NULL AND penalty_score IS NULL
      AND normal_time_home_score IS NOT NULL AND normal_time_away_score IS NOT NULL
      AND (normal_time_home_score <> home_score OR normal_time_away_score <> away_score)
  `)[0]?.values ?? [];
  db.close();
  assert.deepEqual(invalid, [], `invalid 90-minute scores: ${invalid.map((row) => row[0]).join(", ")}`);
}

console.log("result sync parser ok");
