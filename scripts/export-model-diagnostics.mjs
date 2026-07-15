import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "model-audit");
const COMPLETED_EVALUATION_COLUMNS = ["match_id", "model_version", "evaluation_type", "stage", "snapshot_generated_at", "kickoff_time", "actual_score", "predicted", "actual", "one_x_two_correct", "actual_probability", "brier", "log_loss", "exact_score_hit", "top3_score_hit", "top5_score_hit", "actual_score_probability", "exact_score_log_loss", "total_goals_error", "total_goals_squared_error", "over_2_5_correct", "over_2_5_log_loss", "btts_correct", "btts_brier", "btts_log_loss", "market_data_quality", "note"];
const data = mergeFixtures(
  JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "generated-data.json"), "utf8")),
  JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "live-fixtures.json"), "utf8"))
);

const db = await openDb();
const odds = readOdds(db);
const overrides = readOverrides(db);
const teamInputs = readTeamInputs(db);
const preMatchSnapshots = readPreMatchPredictions(db);
db?.close();

const oddsByMatch = groupBy(odds, "matchId");
const overrideByMatch = new Map(overrides.map((row) => [row.matchId, row]));
const inputByTeam = new Map(teamInputs.map((row) => [row.teamName, row]));
const predictions = data.fixtures.map(predict);
const completed = predictions.filter((row) => row.completed);
const scoreFreq = scoreFrequency(predictions);
const replayEvaluation = evaluate(completed);
const evaluation = evaluateArchived(completed, preMatchSnapshots);
const summary = summarize(predictions, completed, evaluation, scoreFreq, replayEvaluation);

fs.mkdirSync(OUT, { recursive: true });
writeJson("model-diagnostics.json", { generatedAt: new Date().toISOString(), flow: modelFlow(), factors: factorMatrix(), summary, matches: predictions });
writeCsv("model-diagnostics.csv", predictions);
writeCsv("scoreline-frequency.csv", scoreFreq);
writeCsv("completed-match-evaluation.csv", evaluation.rows);
fs.writeFileSync(path.join(OUT, "model-summary.md"), markdown(summary, evaluation), "utf8");

console.log(JSON.stringify({ outputDir: OUT, matches: predictions.length, completed: completed.length, strictPreMatchEvaluated: evaluation.rows.length, diagnosticReplayEvaluated: replayEvaluation.rows.length, top1: summary.top1 }, null, 2));

function predict(match) {
  const quotes = oddsByMatch.get(match.id) ?? [];
  const representative = bestQuote(quotes);
  const market = representative ? marketProbabilities(representative) : null;
  const base = baseXg(match);
  const stage = match.stage === "group" ? { h: 1, a: 1, drawBoost: 0 } : { h: 0.94, a: 0.94, drawBoost: 0.045 };
  const lambdaHomeFinal = clamp(base.home * stage.h, 0.18, 4.4);
  const lambdaAwayFinal = clamp(base.away * stage.a, 0.18, 4.4);
  const model = scoreOutcomeProbabilities(lambdaHomeFinal, lambdaAwayFinal, stage.drawBoost);
  const marketWeight = market ? dynamicMarketWeight(representative, quotes) : 0;
  const blended = market ? normalize({
    home: model.home * (1 - marketWeight) + market.home * marketWeight,
    draw: model.draw * (1 - marketWeight) + market.draw * marketWeight,
    away: model.away * (1 - marketWeight) + market.away * marketWeight
  }) : model;
  const matrix = scoreMatrix(lambdaHomeFinal, lambdaAwayFinal);
  const top = [...matrix].sort((x, y) => y.probability - x.probability);
  const actual = overrideByMatch.get(match.id);
  const marketRaw = representative ? rawImplied(representative) : null;
  return {
    match_id: match.id,
    stage: match.stage,
    kickoff_time: match.sortDate,
    home_team: match.home,
    away_team: match.away,
    completed: Boolean(actual),
    actual_score: actual ? `${actual.homeScore}-${actual.awayScore}` : "",
    generated_at: data.generatedAt,
    home_odds: representative?.homePrice ?? null,
    draw_odds: representative?.drawPrice ?? null,
    away_odds: representative?.awayPrice ?? null,
    implied_home_raw: marketRaw?.home ?? null,
    implied_draw_raw: marketRaw?.draw ?? null,
    implied_away_raw: marketRaw?.away ?? null,
    implied_home_no_vig: market?.home ?? null,
    implied_draw_no_vig: market?.draw ?? null,
    implied_away_no_vig: market?.away ?? null,
    market_overround: marketRaw ? marketRaw.home + marketRaw.draw + marketRaw.away - 1 : null,
    total_goals_line: null,
    over_odds: null,
    under_odds: null,
    btts_yes_odds: null,
    btts_no_odds: null,
    odds_source: representative?.provider ?? null,
    odds_updated_at: representative?.fetchedAt ?? null,
    missing_odds: !representative,
    lambda_home: lambdaHomeFinal,
    lambda_away: lambdaAwayFinal,
    lambda_total: lambdaHomeFinal + lambdaAwayFinal,
    lambda_difference: lambdaHomeFinal - lambdaAwayFinal,
    lambda_home_market: null,
    lambda_away_market: null,
    lambda_home_before_adjustment: base.home,
    lambda_away_before_adjustment: base.away,
    lambda_home_final: lambdaHomeFinal,
    lambda_away_final: lambdaAwayFinal,
    market_adjustment: market ? marketWeight : null,
    home_advantage_adjustment: getTeam(match.home).isHost ? 42 : 0,
    attack_strength_adjustment: base.attackNote,
    defense_strength_adjustment: "not separately implemented",
    recent_form_adjustment: base.formBoost,
    weather_adjustment: null,
    temperature_adjustment: null,
    humidity_adjustment: null,
    venue_adjustment: null,
    travel_adjustment: null,
    rest_days_adjustment: null,
    lineup_adjustment: inputByTeam.has(match.home) || inputByTeam.has(match.away) ? "team_inputs absence penalty" : null,
    injury_adjustment: inputByTeam.has(match.home) || inputByTeam.has(match.away) ? "team_inputs injuries/suspensions/keyAbsences" : null,
    match_stage_adjustment: match.stage === "group" ? null : "xG * 0.94, drawBoost +0.045",
    motivation_adjustment: match.stage === "group" ? "group table heuristic in model.ts" : null,
    referee_adjustment: null,
    other_adjustment: "confederation + long-term team market strength if available",
    score_matrix_0_6: matrix.map((x) => `${x.score}:${x.probability.toFixed(8)}`).join("; "),
    top1_score: top[0].score,
    top1_probability: top[0].probability,
    top2_score: top[1].score,
    top2_probability: top[1].probability,
    top3_score: top[2].score,
    top3_probability: top[2].probability,
    top5_scorelines: top.slice(0, 5).map(formatScoreline).join("; "),
    top10_scorelines: top.slice(0, 10).map(formatScoreline).join("; "),
    top3_probability_sum: sum(top.slice(0, 3).map((x) => x.probability)),
    top5_probability_sum: sum(top.slice(0, 5).map((x) => x.probability)),
    score_distribution_entropy: entropy(matrix.map((x) => x.probability)),
    score_distribution_concentration: top[0].probability,
    probability_0_1: scoreProbability(matrix, "0-1"),
    probability_0_2: scoreProbability(matrix, "0-2"),
    probability_1_2: scoreProbability(matrix, "1-2"),
    probability_1_1: scoreProbability(matrix, "1-1"),
    probability_1_0: scoreProbability(matrix, "1-0"),
    probability_2_0: scoreProbability(matrix, "2-0"),
    probability_2_1: scoreProbability(matrix, "2-1"),
    expected_total_goals: lambdaHomeFinal + lambdaAwayFinal,
    probability_under_1_5: totalGoals(matrix, (g) => g < 1.5),
    probability_under_2_5: totalGoals(matrix, (g) => g < 2.5),
    probability_under_3_5: totalGoals(matrix, (g) => g < 3.5),
    probability_over_2_5: totalGoals(matrix, (g) => g > 2.5),
    probability_btts_yes: matrix.filter((x) => x.home > 0 && x.away > 0).reduce((a, b) => a + b.probability, 0),
    probability_btts_no: matrix.filter((x) => x.home === 0 || x.away === 0).reduce((a, b) => a + b.probability, 0),
    probability_clean_sheet_home: matrix.filter((x) => x.away === 0).reduce((a, b) => a + b.probability, 0),
    probability_clean_sheet_away: matrix.filter((x) => x.home === 0).reduce((a, b) => a + b.probability, 0),
    probability_home_win: blended.home,
    probability_draw: blended.draw,
    probability_away_win: blended.away,
    probability_sum_error: Math.abs(sum(matrix.map((x) => x.probability)) - 1),
    home_probability_delta: market ? blended.home - market.home : null,
    draw_probability_delta: market ? blended.draw - market.draw : null,
    away_probability_delta: market ? blended.away - market.away : null,
    total_goals_delta: null,
    notes: factorNotes(match)
  };
}

function baseXg(match) {
  const home = getTeam(match.home);
  const away = getTeam(match.away);
  const hostBoost = home.isHost ? 42 : 0;
  const manualDiff = manualTeamAdjustment(match.home, match.away) + longTermMarketAdjustment(match.home, match.away);
  const diff = (home.elo + hostBoost - away.elo + manualDiff) / 400;
  const formBoost = recentFormBoost(home.name) - recentFormBoost(away.name);
  const confed = confedAdjustment(home.confederation) - confedAdjustment(away.confederation);
  return {
    home: 1.25 * Math.exp(diff * 0.72 + formBoost + confed),
    away: 1.16 * Math.exp(-diff * 0.72 - formBoost - confed),
    formBoost,
    attackNote: `eloDiff=${home.elo - away.elo}, manualDiff=${manualDiff.toFixed(2)}, confed=${confed.toFixed(3)}`
  };
}

function scoreMatrix(homeXg, awayXg) {
  const rows = [];
  for (let h = 0; h <= 6; h += 1) for (let a = 0; a <= 6; a += 1) rows.push({ home: h, away: a, score: `${h}-${a}`, probability: scorelineProbability(homeXg, awayXg, h, a) });
  const total = sum(rows.map((x) => x.probability));
  return rows.map((x) => ({ ...x, probability: x.probability / total }));
}

function scoreOutcomeProbabilities(homeXg, awayXg, drawBoost) {
  const matrix = scoreMatrix(homeXg, awayXg);
  const boosted = matrix.map((row) => ({ ...row, probability: row.probability * stageFactor(row.home, row.away, drawBoost) }));
  const total = sum(boosted.map((x) => x.probability));
  return normalize({
    home: boosted.filter((x) => x.home > x.away).reduce((a, b) => a + b.probability, 0) / total,
    draw: boosted.filter((x) => x.home === x.away).reduce((a, b) => a + b.probability, 0) / total,
    away: boosted.filter((x) => x.home < x.away).reduce((a, b) => a + b.probability, 0) / total
  });
}

function scorelineProbability(homeXg, awayXg, h, a) {
  let factor = 1;
  const minXg = Math.min(homeXg, awayXg);
  const totalXg = homeXg + awayXg;
  if ((h === 0 && a === 0) || (h === 1 && a === 1)) factor *= 1.06;
  if (minXg >= 0.5 && h > 0 && a > 0) factor *= 1.1;
  if (minXg >= 0.72 && h > 0 && a > 0) factor *= 1.07;
  if (a === 0 && h >= 2 && awayXg >= 0.5) factor *= 0.72;
  if (h === 0 && a >= 2 && homeXg >= 0.5) factor *= 0.72;
  if (a === 0 && h === 1 && awayXg >= 0.85) factor *= 0.9;
  if (h === 0 && a === 1 && homeXg >= 0.85) factor *= 0.9;
  if (totalXg >= 2.7 && h + a >= 4 && h > 0 && a > 0) factor *= 1.06;
  return poisson(homeXg, h) * poisson(awayXg, a) * factor;
}

function evaluate(rows) {
  const out = rows.map((row) => {
    const [hs, as] = row.actual_score.split("-").map(Number);
    const actual = hs > as ? "home" : hs < as ? "away" : "draw";
    const predicted = favorite(row);
    const actualKey = actual === "home" ? "probability_home_win" : actual === "away" ? "probability_away_win" : "probability_draw";
    const top = row.top10_scorelines.split("; ").map((x) => x.split(" ")[0]);
    const actualScoreProbability = scoreProbability(scoreMatrix(row.lambda_home, row.lambda_away), row.actual_score);
    const overActual = hs + as > 2.5;
    const bttsActual = hs > 0 && as > 0;
    return {
      match_id: row.match_id,
      stage: row.stage,
      actual_score: row.actual_score,
      predicted,
      actual,
      probability_home_win: row.probability_home_win,
      probability_draw: row.probability_draw,
      probability_away_win: row.probability_away_win,
      probability_over_2_5: row.probability_over_2_5,
      probability_btts_yes: row.probability_btts_yes,
      top3_probability_sum: row.top3_probability_sum,
      one_x_two_correct: predicted === actual,
      actual_probability: row[actualKey],
      brier: brier(row, actual),
      log_loss: -Math.log(Math.max(0.01, row[actualKey])),
      exact_score_hit: row.top1_score === row.actual_score,
      top3_score_hit: [row.top1_score, row.top2_score, row.top3_score].includes(row.actual_score),
      top5_score_hit: top.slice(0, 5).includes(row.actual_score),
      actual_score_probability: actualScoreProbability,
      exact_score_log_loss: -Math.log(Math.max(0.001, actualScoreProbability)),
      total_goals_error: Math.abs(row.expected_total_goals - (hs + as)),
      total_goals_squared_error: (row.expected_total_goals - (hs + as)) ** 2,
      over_2_5_correct: (row.probability_over_2_5 >= 0.5) === (hs + as > 2.5),
      over_2_5_log_loss: binaryLogLoss(row.probability_over_2_5, overActual),
      btts_correct: (row.probability_btts_yes >= 0.5) === bttsActual,
      btts_brier: (row.probability_btts_yes - (bttsActual ? 1 : 0)) ** 2,
      btts_log_loss: binaryLogLoss(row.probability_btts_yes, bttsActual)
    };
  });
  return { rows: out, aggregate: aggregateEvaluation(out) };
}

function evaluateArchived(rows, snapshots) {
  const out = [];
  for (const row of rows) {
    const matchSnapshots = snapshots.get(row.match_id) ?? [];
    const [hs, as] = row.actual_score.split("-").map(Number);
    const actual = hs > as ? "home" : hs < as ? "away" : "draw";
    for (const snap of matchSnapshots) {
      const predicted = snap.oneXTwoSide;
      const actualProbability = snap.probabilities?.[actual] ?? null;
      out.push({
        match_id: row.match_id,
        model_version: snap.modelVersion,
        evaluation_type: "strict pre-match",
        stage: row.stage,
        snapshot_generated_at: snap.generatedAt,
        kickoff_time: row.kickoff_time,
        actual_score: row.actual_score,
        predicted,
        actual,
        probability_home_win: snap.probabilities?.home ?? null,
        probability_draw: snap.probabilities?.draw ?? null,
        probability_away_win: snap.probabilities?.away ?? null,
        probability_over_2_5: snap.probabilityOver25 ?? null,
        probability_btts_yes: snap.probabilityBttsYes ?? null,
        one_x_two_correct: predicted === actual,
        actual_probability: actualProbability,
        brier: snap.probabilities ? brier({ probability_home_win: snap.probabilities.home, probability_draw: snap.probabilities.draw, probability_away_win: snap.probabilities.away }, actual) : null,
        log_loss: actualProbability == null ? null : -Math.log(Math.max(0.01, actualProbability)),
        exact_score_hit: snap.topScorelines[0]?.score === row.actual_score,
        top3_score_hit: snap.topScorelines.slice(0, 3).some((x) => x.score === row.actual_score),
        top5_score_hit: snap.topScorelines.slice(0, 5).some((x) => x.score === row.actual_score),
        actual_score_probability: snap.topScorelines.find((x) => x.score === row.actual_score)?.probability ?? null,
        exact_score_log_loss: null,
        total_goals_error: null,
        total_goals_squared_error: null,
        over_2_5_correct: null,
        over_2_5_log_loss: null,
        btts_correct: null,
        btts_brier: null,
        btts_log_loss: null,
        market_data_quality: snap.marketDataQuality ?? null,
        note: "strict pre-match snapshot evaluation"
      });
    }
  }
  return { rows: out, aggregate: aggregateEvaluation(out) };
}

function summarize(rows, completed, evaluation, freq, replayEvaluation) {
  const targets = ["0-1", "0-2", "1-2", "1-1"];
  const top1 = countBy(rows.map((r) => r.top1_score));
  return {
    matchCount: rows.length,
    completedCount: completed.length,
    strictPreMatchEvaluationCount: evaluation.rows.length,
    strictPreMatchByModel: aggregateBy(evaluation.rows, "model_version"),
    diagnosticReplayEvaluation: replayEvaluation.aggregate,
    lambdaHome: distribution(rows.map((r) => r.lambda_home)),
    lambdaAway: distribution(rows.map((r) => r.lambda_away)),
    top1: Object.fromEntries([...top1.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    top3: Object.fromEntries(freq.slice(0, 12).map((r) => [r.score, r.top3_count])),
    targetScoreShare: Object.fromEntries(targets.map((s) => [s, rows.filter((r) => [r.top1_score, r.top2_score, r.top3_score].includes(s)).length / rows.length])),
    uniqueTop1Scores: top1.size,
    averageTop3ProbabilitySum: avg(rows.map((r) => r.top3_probability_sum)),
    top3Coverage: evaluation.aggregate.top3_score_coverage,
    diagnosticReplayTop3Coverage: replayEvaluation.aggregate.top3_score_coverage,
    stageEvaluation: aggregateBy(evaluation.rows, "stage"),
    timeEvaluation: aggregateTime(evaluation.rows),
    calibration: calibration(evaluation.rows),
    concentration: concentrationStats(rows),
    focusMatches: focusMatches(rows),
    lambdaDuplicates: duplicateLambdas(rows),
    clampCodeLocations: [
      "src/lib/model.ts:44-45 lambda clamp 0.18..4.4",
      "src/lib/model.ts:263-264 group motivation clamp 0.88..1.14",
      "src/lib/model.ts:477-485 manual team adjustment clamp",
      "src/lib/model.ts:585-594 market weight clamp 0.25..0.74"
    ],
    scoreDistributionConcentrated: avg(rows.map((r) => r.top3_probability_sum)) > 0.35,
    oddsDependency: oddsDependency(rows),
    evaluation: evaluation.aggregate,
    implementedFactors: factorMatrix().filter((f) => f.status.startsWith("implemented")).map((f) => f.factor),
    unusedFactors: factorMatrix().filter((f) => !f.status.startsWith("implemented")).map((f) => f.factor),
    limitation: "Strict completed-match evaluation uses only archived pre-match snapshots. Current local snapshots do not cover completed matches, so replay metrics are separated as diagnostic-only and must not be treated as out-of-sample backtest."
  };
}

function markdown(summary, evaluation) {
  return `# Model Diagnostics Summary

Generated: ${new Date().toISOString()}

## Answers

1. Score distribution concentration: ${summary.scoreDistributionConcentrated ? "possible concentration risk" : "no severe concentration by top3 sum"}.
2. Odds dependency: market correlation home/draw/away = ${num(summary.oddsDependency.homeCorrelation)}/${num(summary.oddsDependency.drawCorrelation)}/${num(summary.oddsDependency.awayCorrelation)}; near-identical market matches = ${summary.oddsDependency.nearIdenticalCount}.
3. 0-1/0-2/1-2 high frequency is consistent with current low-to-mid lambda totals and knockout tempo damping where present.
4. Exact-score decline cannot be judged as structural from this export alone; use archived pre-match snapshots before changing weights.
5. Missing variables: weather, confirmed lineup, referee/set-piece profile.
6. Most likely structural issue: score matrix is mostly Elo/manual-input lambda + market-weighted 1X2, with limited independent defensive/team style data.
7. Priority tests: archive predictions before kickoff, ablate market weight, ablate scoreline adjustment, compare 0-6 matrix calibration.
8. Plausible but unproven factors: weather, travel, venue surface, referee, rest-day effects.
9. Suggested ablations: marketWeight=0, no knockout xG damping, no scorelineAdjustment, no iteration adjustments.
10. Baseline to preserve: current exported diagnostics plus current model.ts behavior.

## Key Numbers

- Matches: ${summary.matchCount}
- Completed matches found: ${summary.completedCount}
- Strict pre-match evaluated: ${summary.strictPreMatchEvaluationCount}
- Strict by model: ${JSON.stringify(summary.strictPreMatchByModel)}
- Diagnostic replay evaluated: ${summary.diagnosticReplayEvaluation.evaluated}
- Lambda home: ${JSON.stringify(summary.lambdaHome)}
- Lambda away: ${JSON.stringify(summary.lambdaAway)}
- Top1 frequency: ${JSON.stringify(summary.top1)}
- Target score top3 share: ${JSON.stringify(summary.targetScoreShare)}
- Average top3 probability sum: ${pct(summary.averageTop3ProbabilitySum)}
- Strict actual top3 coverage: ${pct(summary.top3Coverage)}
- Diagnostic replay top3 coverage: ${pct(summary.diagnosticReplayTop3Coverage)}
- Strict 1X2 log loss: ${num(evaluation.aggregate.one_x_two_log_loss)}
- Strict 1X2 Brier: ${num(evaluation.aggregate.one_x_two_brier)}
- Diagnostic replay 1X2 log loss: ${num(summary.diagnosticReplayEvaluation.one_x_two_log_loss)}
- Diagnostic replay 1X2 Brier: ${num(summary.diagnosticReplayEvaluation.one_x_two_brier)}
- Exact score log loss: ${num(evaluation.aggregate.exact_score_log_loss)}
- Total goals RMSE: ${num(evaluation.aggregate.total_goals_rmse)}
- Market dependency: ${JSON.stringify(summary.oddsDependency)}
- Stage evaluation: ${JSON.stringify(summary.stageEvaluation)}

## Provenance

- Code-proven: model uses Elo, host flag, recent form, confederation, manual team inputs, long-term team market strength, odds, group motivation, stage adjustment, iteration calibration.
- Data-proven: odds and result rows were read locally.
- Reasonable inference: scoreline clustering follows lambda and scoreline adjustment.
- Unknown: true out-of-sample pre-match score accuracy without archived prediction snapshots.
`;
}

function factorMatrix() {
  return [
    ["team attack strength", "implemented", "src/lib/model.ts", "Elo/manual value/recent form/confederation into lambda"],
    ["team defense strength", "partially implemented", "src/lib/model.ts", "Only indirectly through Elo/recent goals against, no standalone defense model"],
    ["odds", "implemented", "src/lib/model.ts", "marketProbabilities + blendedProbabilities"],
    ["weather", "not implemented", "", "null in export"],
    ["temperature", "not implemented", "", "null in export"],
    ["humidity", "not implemented", "", "null in export"],
    ["venue", "not implemented", "", "venue displayed but no lambda coefficient"],
    ["host advantage", "implemented", "src/lib/model.ts", "hostBoost when team.isHost"],
    ["lineup", "partially implemented", "src/lib/db.ts team_inputs", "manual inputs can include absences; confirmed XI not modeled structurally"],
    ["injury", "partially implemented", "src/lib/model.ts absencePenalty", "injuries/suspensions/keyAbsences from team_inputs"],
    ["match stage", "implemented", "src/lib/model.ts stageGoalAdjustment", "knockout xG damping and draw boost"],
    ["motivation", "implemented", "src/lib/model.ts groupMotivationAdjustment", "group-stage table heuristic"],
    ["referee", "not implemented", "", "null in export"],
    ["travel/rest", "not implemented", "", "null in export"],
    ["confirmed starting XI", "not implemented", "", "lineup freshness shown, confirmed XI not in scoring model"],
    ["neutral venue", "not implemented", "", "host flag only; no venue coefficient"],
    ["altitude", "not implemented", "", "null in export"],
    ["WBGT", "not implemented", "", "null in export"],
    ["wind/rain/roof/surface", "not implemented", "", "null in export"],
    ["set pieces", "not implemented", "", "null in export"],
    ["must-win pressure", "partially implemented", "src/lib/model.ts groupMotivationAdjustment", "group-stage qualification heuristic only"]
  ].map(([factor, status, codeLocation, method]) => ({ factor, status, codeLocation, method, backtested: "not separately" }));
}

function modelFlow() {
  return ["generated-data/live-fixtures + local sqlite odds/team_inputs/results", "odds decimal prices -> implied probabilities -> no-vig market", "Elo/manual/team-market/recent-form/confed/stage -> lambda_home/lambda_away", "Poisson 0-6 score matrix with scoreline adjustment", "rank scorelines by probability", "export diagnostics only"];
}

function readPreMatchPredictions(db) {
  const out = new Map();
  if (db && tableExists(db, "prediction_snapshots")) {
    for (let offset = 0; ; offset += 500) {
      const rows = db.exec(`
        SELECT match_id, model_version, generated_at, probability_home_win, probability_draw, probability_away_win,
               probability_over_2_5, probability_btts_yes, top10_scorelines_json, market_data_quality
        FROM prediction_snapshots
        WHERE generated_at < kickoff_time
        ORDER BY match_id, model_version, generated_at DESC
        LIMIT 500 OFFSET ${offset}
      `)[0]?.values ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        const matchId = String(row[0]);
        const modelVersion = String(row[1]);
        const bucket = out.get(matchId) ?? [];
        if (bucket.some((item) => item.modelVersion === modelVersion)) continue;
        const probs = { home: Number(row[3]), draw: Number(row[4]), away: Number(row[5]) };
        bucket.push({
          modelVersion,
          generatedAt: String(row[2]),
          probabilities: probs,
          oneXTwoSide: probs.home >= probs.draw && probs.home >= probs.away ? "home" : probs.away >= probs.draw ? "away" : "draw",
          oneXTwoConfidence: Math.max(probs.home, probs.draw, probs.away),
          probabilityOver25: nullableNum(row[6]),
          probabilityBttsYes: nullableNum(row[7]),
          topScorelines: JSON.parse(String(row[8] ?? "[]")),
          marketDataQuality: row[9] == null ? null : String(row[9])
        });
        out.set(matchId, bucket);
      }
    }
    if (out.size) return out;
  }
  const reportPath = path.join(ROOT, ".local", "trade-report.json");
  if (!fs.existsSync(reportPath)) return out;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const generatedAt = report.generatedAt;
  for (const row of report.current ?? []) {
    const fixture = data.fixtures.find((match) => match.id === row.matchId);
    if (!fixture || !generatedAt || new Date(generatedAt) >= new Date(fixture.sortDate)) continue;
    out.set(row.matchId, [{
      modelVersion: "baseline-v1-market-elo",
      generatedAt,
      oneXTwoSide: row.side === "home" || row.side === "away" || row.side === "draw" ? row.side : sideFromLabel(row.markets?.oneXTwo?.label, fixture),
      oneXTwoConfidence: row.markets?.oneXTwo?.confidence ?? null,
      probabilities: null,
      probabilityOver25: null,
      probabilityBttsYes: null,
      topScorelines: row.topScorelines ?? []
    }]);
  }
  return out;
}

function tableExists(db, name) {
  return Boolean(db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)[0]?.values.length);
}

async function openDb() {
  const dbPath = path.join(ROOT, ".local", "worldcup.sqlite");
  if (!fs.existsSync(dbPath)) return null;
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  return new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)));
}

function readOdds(db) {
  if (!db) return [];
  return (db.exec("SELECT match_id, provider, home_price, draw_price, away_price, quote_type, market_kind, fetched_at, source_url FROM odds_quotes")[0]?.values ?? []).map((r) => ({ matchId: String(r[0]), provider: String(r[1]), homePrice: Number(r[2]), drawPrice: Number(r[3]), awayPrice: Number(r[4]), quoteType: String(r[5]), marketKind: String(r[6]), fetchedAt: String(r[7]), sourceUrl: String(r[8]) }));
}
function readOverrides(db) {
  if (!db) return [];
  return (db.exec("SELECT match_id, home_score, away_score, note, updated_at FROM overrides")[0]?.values ?? []).map((r) => ({ matchId: String(r[0]), homeScore: Number(r[1]), awayScore: Number(r[2]), note: r[3] == null ? null : String(r[3]), updatedAt: String(r[4]) }));
}
function readTeamInputs(db) {
  if (!db) return [];
  return (db.exec("SELECT team_name, fifa_rank, market_value_eur_m, projected_xi_value_eur_m, injuries, suspensions, key_absences FROM team_inputs")[0]?.values ?? []).map((r) => ({ teamName: String(r[0]), fifaRank: nullableNum(r[1]), marketValueEurM: nullableNum(r[2]), projectedXIValueEurM: nullableNum(r[3]), injuries: Number(r[4]), suspensions: Number(r[5]), keyAbsences: Number(r[6]) }));
}

function mergeFixtures(base, live) {
  const map = new Map((base.fixtures ?? []).map((f) => [f.id, f]));
  for (const f of live.fixtures ?? []) map.set(f.id, f);
  return { ...base, fixtures: [...map.values()].sort((a, b) => a.matchNumber - b.matchNumber), generatedAt: latestIso(base.generatedAt, live.updatedAt) };
}
function getTeam(name) { return data.teams.find((t) => t.name === name) ?? { name, elo: 1500, confederation: "Unknown", isHost: false, recentForm: { matches: 0, wins: 0, draws: 0, goalsFor: 0, goalsAgainst: 0 } }; }
function bestQuote(quotes) { return [...quotes].filter((q) => q.quoteType !== "opening").sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt)).at(-1) ?? quotes.at(-1) ?? null; }
function rawImplied(o) { return { home: 1 / o.homePrice, draw: 1 / o.drawPrice, away: 1 / o.awayPrice }; }
function marketProbabilities(o) { return normalize(rawImplied(o)); }
function dynamicMarketWeight(quote, quotes) { let w = data.calibration?.defaultMarketWeight ?? 0.65; if (new Set(quotes.map((q) => q.provider)).size <= 1) w -= 0.18; return clamp(w, 0.25, 0.74); }
function manualTeamAdjustment(home, away) { const h = inputByTeam.get(home), a = inputByTeam.get(away); let v = 0; if (h?.fifaRank && a?.fifaRank) v += clamp((a.fifaRank - h.fifaRank) * 1.65, -70, 70); const hv = h?.projectedXIValueEurM ?? h?.marketValueEurM, av = a?.projectedXIValueEurM ?? a?.marketValueEurM; if (hv && av) v += clamp(Math.log(hv / av) * 38, -70, 70); v += absencePenalty(a) - absencePenalty(h); return clamp(v, -150, 150); }
function longTermMarketAdjustment() { return 0; }
function absencePenalty(x) { return x ? x.injuries * 5 + x.suspensions * 12 + x.keyAbsences * 18 : 0; }
function recentFormBoost(name) { const f = getTeam(name).recentForm; if (!f?.matches) return 0; return clamp(((f.wins * 3 + f.draws) / f.matches - 1.35) * 0.025 + ((f.goalsFor - f.goalsAgainst) / f.matches) * 0.015, -0.08, 0.08); }
function confedAdjustment(c) { return ({ UEFA: 0.018, CONMEBOL: 0.016, CONCACAF: 0.004, CAF: 0.002, AFC: 0, OFC: -0.01 })[c] ?? 0; }
function poisson(l, k) { let f = 1; for (let i = 2; i <= k; i += 1) f *= i; return Math.exp(-l) * l ** k / f; }
function stageFactor(h, a, d) { if (d < 0.04) return 1; if ((h === 0 && a === 0) || (h === 1 && a === 1)) return 1.08; if (h + a >= 4 && Math.abs(h - a) >= 2) return 0.86; if ((h === 1 && a === 0) || (h === 0 && a === 1)) return 1.04; return 1; }
function normalize(p) { const t = p.home + p.draw + p.away; return { home: p.home / t, draw: p.draw / t, away: p.away / t }; }
function favorite(r) { return r.probability_home_win >= r.probability_draw && r.probability_home_win >= r.probability_away_win ? "home" : r.probability_away_win >= r.probability_draw ? "away" : "draw"; }
function scoreProbability(m, s) { return m.find((x) => x.score === s)?.probability ?? 0; }
function totalGoals(m, pred) { return m.filter((x) => pred(x.home + x.away)).reduce((a, b) => a + b.probability, 0); }
function formatScoreline(x) { return `${x.score} ${(x.probability * 100).toFixed(2)}%`; }
function scoreFrequency(rows) { const scores = new Map(); for (const r of rows) [r.top1_score, r.top2_score, r.top3_score].forEach((s, i) => { const x = scores.get(s) ?? { score: s, top1_count: 0, top3_count: 0, top3_share: 0 }; if (i === 0) x.top1_count += 1; x.top3_count += 1; scores.set(s, x); }); return [...scores.values()].map((x) => ({ ...x, top3_share: x.top3_count / rows.length })).sort((a, b) => b.top3_count - a.top3_count); }
function aggregateEvaluation(rows) { return { evaluated: rows.length, one_x_two_accuracy: rate(rows, "one_x_two_correct"), one_x_two_log_loss: avg(rows.map((r) => r.log_loss)), one_x_two_brier: avg(rows.map((r) => r.brier)), exact_score_hit_rate: rate(rows, "exact_score_hit"), top3_score_coverage: rate(rows, "top3_score_hit"), top5_score_coverage: rate(rows, "top5_score_hit"), actual_score_average_probability: avg(rows.map((r) => r.actual_score_probability)), exact_score_log_loss: avg(rows.map((r) => r.exact_score_log_loss)), total_goals_mae: avg(rows.map((r) => r.total_goals_error)), total_goals_rmse: Math.sqrt(avg(rows.map((r) => r.total_goals_squared_error)) ?? 0), over_2_5_accuracy: rate(rows, "over_2_5_correct"), over_2_5_log_loss: avg(rows.map((r) => r.over_2_5_log_loss)), btts_accuracy: rate(rows, "btts_correct"), btts_brier: avg(rows.map((r) => r.btts_brier)), btts_log_loss: avg(rows.map((r) => r.btts_log_loss)) }; }
function oddsDependency(rows) { const withMarket = rows.filter((r) => r.implied_home_no_vig != null); const maxDelta = (r) => Math.max(Math.abs(r.home_probability_delta), Math.abs(r.draw_probability_delta), Math.abs(r.away_probability_delta)); return { matchesWithOdds: withMarket.length, homeCorrelation: corr(withMarket.map((r) => r.probability_home_win), withMarket.map((r) => r.implied_home_no_vig)), drawCorrelation: corr(withMarket.map((r) => r.probability_draw), withMarket.map((r) => r.implied_draw_no_vig)), awayCorrelation: corr(withMarket.map((r) => r.probability_away_win), withMarket.map((r) => r.implied_away_no_vig)), nearIdenticalCount: withMarket.filter((r) => maxDelta(r) < 0.01).length, maxDeltaBelow1Point: withMarket.filter((r) => maxDelta(r) < 0.01).length, maxDeltaAbove5Points: withMarket.filter((r) => maxDelta(r) > 0.05).length }; }
function aggregateBy(rows, key) { return Object.fromEntries([...groupBy(rows, key)].map(([k, v]) => [k, aggregateEvaluation(v)])); }
function aggregateTime(rows) { const s = [...rows].sort((a, b) => a.match_id.localeCompare(b.match_id)); return { first20: aggregateEvaluation(s.slice(0, 20)), middle20: aggregateEvaluation(s.slice(Math.max(0, Math.floor(s.length / 2) - 10), Math.max(0, Math.floor(s.length / 2) + 10))), latest20: aggregateEvaluation(s.slice(-20)) }; }
function calibration(rows) { return { home_win: calibrationBins(rows, "probability_home_win", (r) => r.actual === "home"), draw: calibrationBins(rows, "probability_draw", (r) => r.actual === "draw"), away_win: calibrationBins(rows, "probability_away_win", (r) => r.actual === "away"), over_2_5: calibrationBins(rows, "probability_over_2_5", (r) => Number(r.actual_score.split("-")[0]) + Number(r.actual_score.split("-")[1]) > 2.5), btts: calibrationBins(rows, "probability_btts_yes", (r) => { const [h, a] = r.actual_score.split("-").map(Number); return h > 0 && a > 0; }), top3_score_sum: { average_probability: avg(rows.map((r) => r.top3_probability_sum)), actual_coverage: rate(rows, "top3_score_hit") } }; }
function calibrationBins(rows, probKey, hit) { return Array.from({ length: 10 }, (_, i) => { const lo = i / 10, hi = (i + 1) / 10; const bucket = rows.filter((r) => r[probKey] >= lo && (i === 9 ? r[probKey] <= hi : r[probKey] < hi)); return { bin: `${i * 10}-${(i + 1) * 10}%`, count: bucket.length, avg_probability: avg(bucket.map((r) => r[probKey])), actual_rate: bucket.length ? bucket.filter(hit).length / bucket.length : null }; }); }
function concentrationStats(rows) { const by = (label, pick) => Object.fromEntries([...groupBy(rows, pick)].map(([k, v]) => [k, { matches: v.length, average_top3_probability_sum: avg(v.map((r) => r.top3_probability_sum)), unique_top1_scores: new Set(v.map((r) => r.top1_score)).size }])); return { byStage: by("stage", "stage"), byOddsAvailability: by("odds", (r) => r.missing_odds ? "missing_odds" : "has_odds"), byLambdaTotal: by("lambda", (r) => r.lambda_total < 2 ? "lt2" : r.lambda_total < 3 ? "2to3" : "gte3"), byFavoriteGap: by("gap", (r) => Math.max(r.probability_home_win, r.probability_draw, r.probability_away_win) < 0.45 ? "balanced" : "favorite") }; }
function focusMatches(rows) { const wanted = [["France", "Paraguay"], ["Canada", "Morocco"], ["Paraguay", "Germany"]]; const direct = wanted.map(([a, b]) => rows.find((r) => [r.home_team, r.away_team].includes(a) && [r.home_team, r.away_team].includes(b))).filter(Boolean); const special = rows.filter((r) => ["0-1", "0-2", "1-2"].includes(r.top1_score)); return [...direct, ...special].map((r) => ({ match_id: r.match_id, match: `${r.home_team} vs ${r.away_team}`, actual_score: r.actual_score, home_odds: r.home_odds, draw_odds: r.draw_odds, away_odds: r.away_odds, lambda_home: r.lambda_home, lambda_away: r.lambda_away, expected_total_goals: r.expected_total_goals, top3: [r.top1_score, r.top2_score, r.top3_score].join("/"), adjustments: { market: r.market_adjustment, home: r.home_advantage_adjustment, form: r.recent_form_adjustment, stage: r.match_stage_adjustment, injury: r.injury_adjustment }, missing: { weather: true, defense_model: r.defense_strength_adjustment === "not separately implemented", venue_model: true } })); }
function duplicateLambdas(rows) { const groups = [...groupBy(rows, (r) => `${r.lambda_home.toFixed(3)}:${r.lambda_away.toFixed(3)}`)].filter(([, v]) => v.length > 1); return groups.map(([lambda, v]) => ({ lambda, matches: v.map((r) => r.match_id) })).slice(0, 20); }
function binaryLogLoss(p, actual) { return -Math.log(Math.max(0.01, Math.min(0.99, actual ? p : 1 - p))); }
function factorNotes(match) { return ["weather: not implemented", "venue: displayed but not weighted", "lineup/injury: partial via team_inputs", `stage: ${match.stage === "group" ? "group motivation possible" : "knockout tempo damping"}`].join("; "); }
function brier(r, actual) { return ((r.probability_home_win - (actual === "home" ? 1 : 0)) ** 2 + (r.probability_draw - (actual === "draw" ? 1 : 0)) ** 2 + (r.probability_away_win - (actual === "away" ? 1 : 0)) ** 2) / 3; }
function distribution(v) { return { min: Math.min(...v), max: Math.max(...v), avg: avg(v), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75) }; }
function quantile(v, q) { const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * q)] ?? null; }
function countBy(v) { const m = new Map(); for (const x of v) m.set(x, (m.get(x) ?? 0) + 1); return m; }
function groupBy(rows, key) { const m = new Map(); for (const row of rows) { const k = typeof key === "function" ? key(row) : row[key]; const bucket = m.get(k) ?? []; bucket.push(row); m.set(k, bucket); } return m; }
function corr(a, b) { const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); const ax = avg(pairs.map((p) => p[0])), ay = avg(pairs.map((p) => p[1])); const cov = avg(pairs.map(([x, y]) => (x - ax) * (y - ay))); const sx = Math.sqrt(avg(pairs.map(([x]) => (x - ax) ** 2)) ?? 0), sy = Math.sqrt(avg(pairs.map(([, y]) => (y - ay) ** 2)) ?? 0); return sx && sy ? cov / (sx * sy) : null; }
function entropy(v) { return -v.reduce((a, p) => a + (p > 0 ? p * Math.log2(p) : 0), 0); }
function rate(rows, key) { const eligible = rows.filter((r) => typeof r[key] === "boolean"); return eligible.length ? eligible.filter((r) => r[key]).length / eligible.length : null; }
function avg(v) { const x = v.filter(Number.isFinite); return x.length ? sum(x) / x.length : null; }
function sum(v) { return v.reduce((a, b) => a + b, 0); }
function pct(v) { return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`; }
function num(v) { return v == null ? "n/a" : Number(v).toFixed(3); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function nullableNum(v) { return v == null ? null : Number(v); }
function latestIso(a, b) { return b && new Date(b) > new Date(a) ? b : a; }
function writeJson(name, value) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sideFromLabel(label, fixture) { const s = String(label ?? "").toLowerCase(); if (s.includes("draw") || s.includes("平")) return "draw"; if (s.includes(String(fixture.home).toLowerCase())) return "home"; if (s.includes(String(fixture.away).toLowerCase())) return "away"; return null; }
function writeCsv(name, rows) { const cols = rows.length ? [...new Set(rows.flatMap((r) => Object.keys(r)))] : name === "completed-match-evaluation.csv" ? COMPLETED_EVALUATION_COLUMNS : []; fs.writeFileSync(path.join(OUT, name), [cols.join(","), ...rows.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\n") + "\n", "utf8"); }
function csv(v) { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
