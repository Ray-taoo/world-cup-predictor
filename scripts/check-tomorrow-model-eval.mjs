import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, ".local", "worldcup.sqlite");
const OUT_PATH = path.join(ROOT, ".local", "tomorrow-model-eval.json");
const PREMATCH_PATH = path.join(ROOT, ".local", "tomorrow-model-eval-prematch.json");
const SITE = (process.env.WORLDCUP_SITE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const MODELS = ["market-only-v1", "baseline-v1-market-elo", "hybrid-v2-knockout"];
const PREFERRED = ["M097", "M098"];

const response = await fetch(`${SITE}/api/model-comparison`, { cache: "no-store" });
if (!response.ok) throw new Error(`model comparison request failed: ${response.status} ${response.statusText}`);
const payload = await response.json();
const db = await openDb();

try {
  const completed = storedPreMatchReports()
    .filter((match) => resultFor(match.matchId))
    .sort((a, b) => b.kickoffTime.localeCompare(a.kickoffTime))
    .slice(0, 2)
    .map(refreshStoredMatch);
  const matches = pickMatches(payload.matches ?? []).slice(0, 4 - completed.length);
  if (!matches.length && !completed.length) throw new Error("no strict completed or future knockout matches available for evaluation");
  const report = {
    generatedAt: payload.generatedAt,
    source: `${SITE}/api/model-comparison`,
    selectionRule: "latest 1-2 completed matches retained from strict pre-match reports, then prefer M097/M098 and nearest future matches; maximum 4",
    completedEvaluationSummary: summarizeCompleted(),
    safeguards: [
      "baseline-v1-market-elo must equal official predictionForMatch(...).blended",
      "evaluation uses only strict pre-kickoff snapshots when a final result exists",
      "missing market/context inputs stay marked missing"
    ],
    matches: [...completed, ...matches.map((match) => reportMatch(match))]
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db?.close();
}

function storedPreMatchReports() {
  const stored = new Map();
  for (const file of [OUT_PATH, PREMATCH_PATH]) {
    if (!fs.existsSync(file)) continue;
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const match of report.matches ?? []) {
      if (new Date(report.generatedAt).getTime() >= new Date(match.kickoffTime).getTime()) continue;
      const previous = stored.get(match.matchId);
      if (!previous || report.generatedAt > previous.reportGeneratedAt) stored.set(match.matchId, { ...match, reportGeneratedAt: report.generatedAt });
    }
  }
  return [...stored.values()];
}

function refreshStoredMatch(match) {
  return {
    ...match,
    strictStatus: "strict result available; evaluation uses pre-match snapshot only",
    predictionSource: `frozen pre-match report ${match.reportGeneratedAt}`,
    models: match.models.map((model) => ({
      ...model,
      postMatchEvaluation: evaluateIfFinished(match, model.modelVersion)
    }))
  };
}

function summarizeCompleted() {
  const matchIds = strictCompletedMatchIds();
  return Object.fromEntries(MODELS.map((version) => {
    const evaluations = matchIds
      .map((matchId) => ({ matchId, evaluation: evaluateIfFinished({ matchId }, version) }))
      .filter((row) => row.evaluation.status === "evaluated_from_strict_pre_match_snapshot");
    if (!evaluations.length) return [version, { sampleSize: 0 }];
    return [version, {
      sampleSize: evaluations.length,
      evaluatedMatchIds: evaluations.map((row) => row.matchId),
      hit1x2: evaluations.filter((row) => row.evaluation.hit1x2).length,
      hitRealTop3Scorelines: evaluations.filter((row) => row.evaluation.hitRealTop3Scorelines).length,
      meanLogLoss1x2: round(mean(evaluations.map((row) => row.evaluation.logLoss1x2))),
      meanBrierScore: round(mean(evaluations.map((row) => row.evaluation.brierScore))),
      hitOver25: evaluations.filter((row) => row.evaluation.hitOver25).length,
      hitBtts: evaluations.filter((row) => row.evaluation.hitBtts).length
    }];
  }));
}

function strictCompletedMatchIds() {
  if (!db) return [];
  const rows = db.exec(`
    SELECT DISTINCT ps.match_id
    FROM prediction_snapshots ps
    INNER JOIN overrides o ON o.match_id = ps.match_id
    WHERE ps.generated_at < ps.kickoff_time
    ORDER BY ps.match_id
  `)[0]?.values ?? [];
  return rows.map((row) => String(row[0]));
}

function pickMatches(matches) {
  const preferred = matches.filter((match) => PREFERRED.includes(match.matchId));
  const chosen = [...preferred];
  for (const match of matches) {
    if (chosen.length >= 4) break;
    if (!chosen.some((row) => row.matchId === match.matchId)) chosen.push(match);
  }
  return chosen.slice(0, Math.max(2, Math.min(4, chosen.length)));
}

function reportMatch(match) {
  if (!(new Date(payload.generatedAt).getTime() < new Date(match.kickoffTime).getTime())) {
    throw new Error(`${match.matchId} generatedAt is not before kickoff; refusing to label as pre-match`);
  }
  const versions = new Map((match.comparison?.versions ?? []).map((row) => [row.version, row]));
  const rows = MODELS.map((version) => {
    const variant = versions.get(version);
    if (!variant) throw new Error(`${match.matchId} missing ${version}`);
    if (version === "baseline-v1-market-elo") assertBaseline(match, variant);
    assertMissingInputsHonest(match.matchId, variant);
    const top3 = (variant.topScorelines ?? []).slice(0, 3);
    return {
      modelVersion: version,
      selected1x2: selected1x2(variant.probabilities90),
      probabilities90: roundSet(variant.probabilities90),
      realTop1Score: top3[0]?.score ?? null,
      realTop1ScoreProbability: round(top3[0]?.probability ?? null),
      realTop3Scorelines: top3.map((row) => ({ score: row.score, probability: round(row.probability) })),
      realTop3ScorelinesText: top3.map((row) => `${row.score} ${pct(row.probability)}`).join(" / "),
      scoreDirectionConflict: top3[0] ? scoreDirection(top3[0].score) !== selected1x2(variant.probabilities90) : null,
      lambdaHome: round(variant.lambdaHome),
      lambdaAway: round(variant.lambdaAway),
      lambdaTotal: round(variant.lambdaTotal),
      lambdaDifference: round(variant.lambdaDifference),
      probabilityOver25: round(variant.probabilityOver25),
      probabilityBttsYes: round(variant.probabilityBttsYes),
      probabilityHomeAdvance: round(variant.probabilityHomeAdvance),
      probabilityAwayAdvance: round(variant.probabilityAwayAdvance),
      marketDataQuality: variant.marketDataQuality,
      missingMarketInputs: variant.missingMarketInputs ?? [],
      missingContextInputs: variant.missingContextInputs ?? ["confirmed_lineup", "injury_feed", "weather", "venue"],
      contextInputs: variant.contextInputs ?? null,
      oddsTimestamp: match.oddsTimestamp ?? null,
      conciseInterpretation: interpretation(version, variant),
      postMatchEvaluation: evaluateIfFinished(match, version)
    };
  });
  return {
    matchId: match.matchId,
    match: `${match.home} vs ${match.away}`,
    kickoffTime: match.kickoffTime,
    beijingKickoff: formatBeijing(match.kickoffTime),
    strictStatus: resultFor(match.matchId) ? "strict result available; evaluation uses pre-match snapshot only" : "strict result pending",
    models: rows,
    disagreementSummary: disagreement(rows)
  };
}

function assertBaseline(match, variant) {
  for (const side of ["home", "draw", "away"]) {
    const delta = Math.abs(variant.probabilities90[side] - match.baselineReference[side]);
    if (delta > 1e-12) throw new Error(`${match.matchId} baseline-v1-market-elo changed official ${side}: ${delta}`);
  }
}

function assertMissingInputsHonest(matchId, variant) {
  if (variant.marketDataQuality === "full" && (variant.missingMarketInputs ?? []).length) {
    throw new Error(`${matchId} ${variant.version} says marketDataQuality=full while listing missing inputs`);
  }
}

function evaluateIfFinished(match, version) {
  const result = resultFor(match.matchId);
  if (!result) return { status: "strict result pending" };
  const snapshot = latestSnapshot(match.matchId, version);
  if (!snapshot) return { status: "final result exists but no strict pre-match snapshot" };
  const actualDirection = result.homeScore > result.awayScore ? "home" : result.homeScore === result.awayScore ? "draw" : "away";
  const actualScore = `${result.homeScore}-${result.awayScore}`;
  const top3 = snapshot.top10.slice(0, 3);
  return {
    status: "evaluated_from_strict_pre_match_snapshot",
    actualScore,
    hit1x2: selected1x2(snapshot.probabilities90) === actualDirection,
    hitRealTop1Score: top3[0]?.score === actualScore,
    hitRealTop3Scorelines: top3.some((row) => row.score === actualScore),
    logLoss1x2: round(-Math.log(Math.max(snapshot.probabilities90[actualDirection], 1e-15))),
    brierScore: round(["home", "draw", "away"].reduce((sum, side) => sum + (snapshot.probabilities90[side] - (side === actualDirection ? 1 : 0)) ** 2, 0)),
    totalGoalsAbsoluteError: round(Math.abs(expectedTotalGoals(top3) - result.homeScore - result.awayScore)),
    homeGoalsAbsoluteError: round(Math.abs((snapshot.lambdaHome ?? 0) - result.homeScore)),
    awayGoalsAbsoluteError: round(Math.abs((snapshot.lambdaAway ?? 0) - result.awayScore)),
    hitOver25: (snapshot.probabilityOver25 >= 0.5) === (result.homeScore + result.awayScore > 2.5),
    hitBtts: (snapshot.probabilityBttsYes >= 0.5) === (result.homeScore > 0 && result.awayScore > 0)
  };
}

function disagreement(rows) {
  const selected = new Set(rows.map((row) => row.selected1x2));
  const top1 = new Set(rows.map((row) => row.realTop1Score));
  const top3Sets = rows.map((row) => new Set(row.realTop3Scorelines.map((score) => score.score)));
  const sharedTop3 = [...top3Sets[0]].filter((score) => top3Sets.every((set) => set.has(score))).length;
  const ranges = {
    "1X2 probability": maxRange(rows.flatMap((row) => Object.values(row.probabilities90))),
    realTop1Score: top1.size - 1,
    "draw risk": maxRange(rows.map((row) => row.probabilities90.draw)),
    BTTS: maxRange(rows.map((row) => row.probabilityBttsYes)),
    "Over 2.5": maxRange(rows.map((row) => row.probabilityOver25)),
    "advance probability": maxRange(rows.flatMap((row) => [row.probabilityHomeAdvance, row.probabilityAwayAdvance])),
    "market-data completeness": new Set(rows.map((row) => row.marketDataQuality)).size - 1
  };
  const largest = Object.entries(ranges).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
  return {
    sameSelected1x2: selected.size === 1,
    sameRealTop1Score: top1.size === 1,
    realTop3HighlyOverlapping: sharedTop3 >= 2,
    largestDisagreement: largest
  };
}

function selected1x2(p) {
  if (!p || p.home + p.draw + p.away <= 0) return null;
  return ["home", "draw", "away"].sort((a, b) => p[b] - p[a])[0];
}

function scoreDirection(score) {
  const [home, away] = score.split("-").map(Number);
  return home > away ? "home" : home === away ? "draw" : "away";
}

function interpretation(version, variant) {
  if (version === "baseline-v1-market-elo") return "Baseline is the official 90-minute model and must match predictionForMatch(...).blended.";
  if (version === "market-only-v1") return `Market-only follows available odds inputs; quality is ${variant.marketDataQuality}.`;
  return "Hybrid blends market and independent team lambdas with knockout draw/low-score handling.";
}

async function openDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  return new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)));
}

function resultFor(matchId) {
  if (!db) return null;
  const row = db.exec(`SELECT home_score, away_score FROM overrides WHERE match_id = ${sql(matchId)} LIMIT 1`)[0]?.values?.[0];
  return row ? { homeScore: Number(row[0]), awayScore: Number(row[1]) } : null;
}

function latestSnapshot(matchId, version) {
  if (!db) return null;
  const row = db.exec(`
    SELECT probability_home_win, probability_draw, probability_away_win, probability_over_2_5,
           probability_btts_yes, top10_scorelines_json, lambda_final_home, lambda_final_away
    FROM prediction_snapshots
    WHERE match_id = ${sql(matchId)} AND model_version = ${sql(version)} AND generated_at < kickoff_time
    ORDER BY generated_at DESC
    LIMIT 1
  `)[0]?.values?.[0];
  if (!row) return null;
  return {
    probabilities90: { home: Number(row[0]), draw: Number(row[1]), away: Number(row[2]) },
    probabilityOver25: Number(row[3]),
    probabilityBttsYes: Number(row[4]),
    top10: JSON.parse(String(row[5])),
    lambdaHome: row[6] == null ? null : Number(row[6]),
    lambdaAway: row[7] == null ? null : Number(row[7])
  };
}

function expectedTotalGoals(top3) {
  const totalProb = top3.reduce((sum, row) => sum + row.probability, 0);
  if (!totalProb) return 0;
  return top3.reduce((sum, row) => {
    const [home, away] = row.score.split("-").map(Number);
    return sum + (home + away) * row.probability;
  }, 0) / totalProb;
}

function maxRange(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? Math.max(...nums) - Math.min(...nums) : 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roundSet(p) {
  return { home: round(p.home), draw: round(p.draw), away: round(p.away) };
}

function round(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(6));
}

function pct(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatBeijing(value) {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
