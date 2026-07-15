const site = process.env.WORLDCUP_SITE_URL ?? "http://127.0.0.1:3000";
const query = new URLSearchParams();
for (const matchId of (process.env.MODEL_CHECK_MATCH_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
  query.append("matchId", matchId);
}
const suffix = query.size ? `?${query}` : "";
const response = await fetch(`${site.replace(/\/$/, "")}/api/model-comparison${suffix}`, { cache: "no-store" });
if (!response.ok) throw new Error(`model comparison failed: ${response.status}`);
const payload = await response.json();

let maxMatrixSumError = 0;
let marketSolverUsesOuAh = false;
let marketSolverUsesBtts = false;
let hybridUsesRealContext = false;
for (const match of payload.matches ?? []) {
  if (/winner|loser|runner-up|tbd|third|match \d+/i.test(`${match.home} ${match.away}`)) {
    throw new Error(`TBD match leaked into model comparison: ${match.matchId}`);
  }
  const versions = new Map((match.comparison?.versions ?? []).map((row) => [row.version, row]));
  for (const name of ["market-only-v1", "baseline-v1-market-elo", "hybrid-v2-knockout"]) {
    if (!versions.has(name)) throw new Error(`${match.matchId} missing ${name}`);
  }
  const baseline = versions.get("baseline-v1-market-elo");
  const market = versions.get("market-only-v1");
  const hybrid = versions.get("hybrid-v2-knockout");
  if (!Array.isArray(hybrid.missingContextInputs)) throw new Error(`${match.matchId} hybrid missing context audit`);
  if (hybrid.missingContextInputs.length < 4) hybridUsesRealContext = true;
  for (const side of ["home", "draw", "away"]) {
    const delta = Math.abs(baseline.probabilities90[side] - match.baselineReference[side]);
    if (delta > 1e-12) throw new Error(`${match.matchId} baseline changed on ${side}: ${delta}`);
  }
  if (
    hybrid.componentLambdas.teamHome == null ||
    hybrid.componentLambdas.teamAway == null ||
    Math.abs(hybrid.componentLambdas.teamHome - baseline.componentLambdas.teamHome) + Math.abs(hybrid.componentLambdas.teamAway - baseline.componentLambdas.teamAway) < 1e-9
  ) {
    throw new Error(`${match.matchId} hybrid team lambdas are not independent from baseline`);
  }
  const marketSide = selectedSide(market.probabilities90);
  const baselineSide = selectedSide(baseline.probabilities90);
  if (marketSide === baselineSide && market.probabilities90[marketSide] >= 0.55 && baseline.probabilities90[baselineSide] >= 0.55) {
    const floor = Math.min(market.probabilities90[marketSide], baseline.probabilities90[baselineSide]) - 0.05;
    if (hybrid.probabilities90[marketSide] < floor) throw new Error(`${match.matchId} hybrid consensus favorite fell below floor`);
    if (scoreSide(hybrid.topScorelines[0]?.score) !== marketSide) throw new Error(`${match.matchId} hybrid top score conflicts with consensus favorite`);
  }
  for (const variant of versions.values()) {
    if (variant.lambdaHome != null && variant.lambdaAway != null) {
      const totalDelta = Math.abs(variant.lambdaTotal - (variant.lambdaHome + variant.lambdaAway));
      const diffDelta = Math.abs(variant.lambdaDifference - (variant.lambdaHome - variant.lambdaAway));
      if (totalDelta > 1e-12) throw new Error(`${match.matchId} ${variant.version} lambdaTotal mismatch`);
      if (diffDelta > 1e-12) throw new Error(`${match.matchId} ${variant.version} lambdaDifference mismatch`);
    }
    if (variant.marketDataQuality === "h2h_only") {
      if (!match.oddsTimestamp) throw new Error(`${match.matchId} missing oddsTimestamp`);
      for (const missing of ["over_under", "asian_handicap", "btts"]) {
        if (!variant.missingMarketInputs.includes(missing)) throw new Error(`${match.matchId} ${variant.version} did not record missing ${missing}`);
      }
    }
    if (variant.version === "market-only-v1" && !variant.missingMarketInputs.includes("over_under") && !variant.missingMarketInputs.includes("asian_handicap")) {
      marketSolverUsesOuAh = true;
    }
    if (variant.version === "market-only-v1" && !variant.missingMarketInputs.includes("btts")) marketSolverUsesBtts = true;
    if (variant.fullScoreMatrix.length) {
      const sum = variant.fullScoreMatrix.reduce((total, row) => total + row.probability, 0);
      maxMatrixSumError = Math.max(maxMatrixSumError, Math.abs(sum - 1));
      if (variant.topScorelines.length < 3 || variant.topScorelines.length > 10) throw new Error(`${match.matchId} ${variant.version} top scoreline count invalid`);
    }
  }
}

if (maxMatrixSumError > 1e-6) throw new Error(`score matrix normalization error ${maxMatrixSumError}`);
if (!marketSolverUsesOuAh) throw new Error("market-only-v1 did not use available OU/AH markets");
if (!marketSolverUsesBtts) throw new Error("market-only-v1 did not use real BTTS market");
if (!hybridUsesRealContext) throw new Error("hybrid-v2-knockout did not use real match context");
console.log(JSON.stringify({ matches: payload.matches?.length ?? 0, maxMatrixSumError, marketSolverUsesOuAh, marketSolverUsesBtts, hybridUsesRealContext }, null, 2));

function selectedSide(probabilities) {
  return ["home", "draw", "away"].sort((a, b) => probabilities[b] - probabilities[a])[0];
}

function scoreSide(score) {
  if (!score) return null;
  const [home, away] = score.split("-").map(Number);
  return home > away ? "home" : home === away ? "draw" : "away";
}
