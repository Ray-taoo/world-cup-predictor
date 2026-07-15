import { getTeam } from "@/lib/data";
import { marketProbabilities, scorelineProbability, scoreProbabilities } from "@/lib/model";
import type { Fixture, MatchContextInput, OddsQuote, ProbabilitySet, TeamInput } from "@/lib/types";

export type ModelVersion = "market-only-v1" | "baseline-v1-market-elo" | "hybrid-v2-knockout";

export interface ScoreMatrixCell {
  score: string;
  home: number;
  away: number;
  probabilityBeforeDc: number;
  probability: number;
}

export interface ModelVariantPrediction {
  version: ModelVersion;
  lambdaHome: number | null;
  lambdaAway: number | null;
  lambdaTotal: number | null;
  lambdaDifference: number | null;
  probabilities90: ProbabilitySet;
  topScorelines: Array<{ score: string; probability: number }>;
  fullScoreMatrix: ScoreMatrixCell[];
  probabilityOver25: number | null;
  probabilityUnder25: number | null;
  probabilityBttsYes: number | null;
  probabilityBttsNo: number | null;
  probabilityExtraTime: number | null;
  probabilityPenalties: number | null;
  probabilityHomeAdvance: number | null;
  probabilityAwayAdvance: number | null;
  componentLambdas: {
    marketHome: number | null;
    marketAway: number | null;
    marketTotal: number | null;
    marketDifference: number | null;
    teamHome: number | null;
    teamAway: number | null;
    teamTotal: number | null;
    teamDifference: number | null;
    finalHome: number | null;
    finalAway: number | null;
    finalTotal: number | null;
    finalDifference: number | null;
  };
  marketDataQuality: "full" | "partial" | "h2h_only" | "missing";
  missingMarketInputs: string[];
  missingContextInputs: string[];
  contextInputs: MatchContextInput | null;
  solverError: string | null;
  solverResidual: number | null;
  dixonColesRho: number | null;
  confidence: number;
  explanation: string[];
}

export interface ModelComparison {
  matchId: string;
  versions: ModelVariantPrediction[];
}

export function compareModelVersions(
  match: Fixture,
  odds: OddsQuote | OddsQuote[] | null,
  teamInputs: TeamInput[],
  baseline: { blended: ProbabilitySet; xgHome: number; xgAway: number },
  context: MatchContextInput | null = null
): ModelComparison {
  const quote = Array.isArray(odds) ? latestQuote(odds) : odds;
  const market = marketOnly(match, quote);
  const team = teamAttackDefenseLambdas(match, teamInputs, context);
  const hybrid = hybridKnockout(match, market, team, baseline, context);
  return {
    matchId: match.id,
    versions: [
      fromLambdas("market-only-v1", market.lambdaHome, market.lambdaAway, market.quality, {
        ...market,
        components: { marketHome: market.lambdaHome, marketAway: market.lambdaAway, teamHome: null, teamAway: null },
        missingContext: ["confirmed_lineup", "injury_feed", "weather", "venue"]
      }),
      fromLambdas("baseline-v1-market-elo", baseline.xgHome, baseline.xgAway, quote ? "h2h_only" : "missing", {
        target: baseline.blended,
        residual: null,
        error: null,
        missing: ["over_under", "asian_handicap", "btts"],
        components: { marketHome: market.lambdaHome, marketAway: market.lambdaAway, teamHome: baseline.xgHome, teamAway: baseline.xgAway },
        missingContext: ["confirmed_lineup", "injury_feed", "weather", "venue"]
      }),
      fromLambdas("hybrid-v2-knockout", hybrid.home, hybrid.away, market.quality, {
        target: null,
        residual: hybrid.residual,
        error: market.error,
        missing: market.missing,
        rho: -0.08,
        components: { marketHome: market.lambdaHome, marketAway: market.lambdaAway, teamHome: team.xgHome, teamAway: team.xgAway },
        explanation: hybrid.explanation,
        context,
        missingContext: missingContextInputs(context)
      })
    ]
  };
}

function marketOnly(match: Fixture, odds: OddsQuote | null) {
  const target = marketProbabilities(odds);
  if (!target) {
    return { lambdaHome: null, lambdaAway: null, target: null, residual: null, error: "missing h2h odds", missing: ["h2h", "over_under", "asian_handicap", "btts"], quality: "missing" as const };
  }
  const overUnder = odds?.totalLine != null && odds.overPrice && odds.underPrice ? { line: odds.totalLine, ...binaryTarget(odds.overPrice, odds.underPrice) } : null;
  const handicap = odds?.handicapLine != null && odds.homeHandicapPrice && odds.awayHandicapPrice ? { line: odds.handicapLine, ...binaryTarget(odds.homeHandicapPrice, odds.awayHandicapPrice) } : null;
  const btts = odds?.bttsYesPrice && odds.bttsNoPrice ? binaryTarget(odds.bttsYesPrice, odds.bttsNoPrice) : null;
  const missing = [
    overUnder ? null : "over_under",
    handicap ? null : "asian_handicap",
    btts ? null : "btts"
  ].filter((item): item is string => Boolean(item));
  const quality: ModelVariantPrediction["marketDataQuality"] = missing.length === 0 ? "full" : missing.length === 3 ? "h2h_only" : "partial";
  let best = { h: 1.2, a: 1.1, residual: Number.POSITIVE_INFINITY };
  for (let h = 0.25; h <= 4.5; h += 0.05) {
    for (let a = 0.25; a <= 4.5; a += 0.05) {
      const p = scoreProbabilities(h, a);
      const matrix = scoreMatrix(h, a, null);
      let residual = squared(p.home - target.home) + squared(p.draw - target.draw) + squared(p.away - target.away);
      if (overUnder) residual += squared(totalGoalsProbability(matrix, overUnder.line, "over") - overUnder.first) + squared(totalGoalsProbability(matrix, overUnder.line, "under") - overUnder.second);
      if (handicap) residual += squared(handicapProbability(matrix, handicap.line, "home") - handicap.first) + squared(handicapProbability(matrix, handicap.line, "away") - handicap.second);
      if (btts) residual += squared(bttsProbability(matrix) - btts.first) + squared((1 - bttsProbability(matrix)) - btts.second);
      if (residual < best.residual) best = { h, a, residual };
    }
  }
  return {
    lambdaHome: best.h,
    lambdaAway: best.a,
    target,
    residual: best.residual,
    error: null,
    missing,
    quality,
    explanation: [`market solver used ${quality === "h2h_only" ? "1X2 only" : `1X2 plus ${["over/under", "handicap", "BTTS"].filter((_, i) => !missing.includes(["over_under", "asian_handicap", "btts"][i])).join(", ")}`} for ${match.id}`]
  };
}

function binaryTarget(firstPrice: number, secondPrice: number): { first: number; second: number } {
  const firstRaw = 1 / firstPrice;
  const secondRaw = 1 / secondPrice;
  const total = firstRaw + secondRaw;
  return { first: firstRaw / total, second: secondRaw / total };
}

function totalGoalsProbability(matrix: ScoreMatrixCell[], line: number, side: "over" | "under"): number {
  return matrix.filter((row) => side === "over" ? row.home + row.away > line : row.home + row.away < line).reduce((sum, row) => sum + row.probability, 0);
}

function handicapProbability(matrix: ScoreMatrixCell[], line: number, side: "home" | "away"): number {
  return matrix.filter((row) => side === "home" ? row.home + line > row.away : row.away - line > row.home).reduce((sum, row) => sum + row.probability, 0);
}

function bttsProbability(matrix: ScoreMatrixCell[]): number {
  return matrix.filter((row) => row.home > 0 && row.away > 0).reduce((sum, row) => sum + row.probability, 0);
}

function hybridKnockout(
  match: Fixture,
  market: ReturnType<typeof marketOnly>,
  team: { xgHome: number; xgAway: number },
  baseline: { blended: ProbabilitySet; xgHome: number; xgAway: number },
  context: MatchContextInput | null
) {
  const weights = [0.35, 0.5, 0.65];
  const marketHome = market.lambdaHome ?? team.xgHome;
  const marketAway = market.lambdaAway ?? team.xgAway;
  const pickedWeight = market.lambdaHome == null ? 0.35 : 0.5;
  let home = geometricBlend(marketHome, team.xgHome, pickedWeight);
  let away = geometricBlend(marketAway, team.xgAway, pickedWeight);
  const marketSide = market.target && strongestSide(market.target);
  const baselineSide = strongestSide(baseline.blended);
  const consensusFavorite = marketSide === baselineSide && marketSide !== "draw" && market.target &&
    market.target[marketSide] >= 0.55 && baseline.blended[baselineSide] >= 0.55;
  if (consensusFavorite && marketSide === "home") {
    home = Math.max(home, Math.min(marketHome, baseline.xgHome) * 0.95);
    away = Math.min(away, geometricBlend(marketAway, baseline.xgAway, 0.5) * 0.98);
  } else if (consensusFavorite && marketSide === "away") {
    home = Math.min(home, geometricBlend(marketHome, baseline.xgHome, 0.5) * 0.98);
    away = Math.max(away, Math.min(marketAway, baseline.xgAway) * 0.95);
  }
  const damp = (match.stage === "group" ? 1 : 0.98) * (context?.weather?.lambdaMultiplier ?? 1);
  return {
    home: clamp(home * damp, 0.18, 4.4),
    away: clamp(away * damp, 0.18, 4.4),
    probabilities: scoreProbabilities(clamp(home * damp, 0.18, 4.4), clamp(away * damp, 0.18, 4.4)),
    residual: market.residual,
    explanation: [
      `tested market weights ${weights.join("/")}; using ${pickedWeight} until strict snapshot backtest selects a winner`,
      consensusFavorite ? "applied consensus-favorite lambda floor because market and baseline both exceeded 55%" : "no consensus-favorite floor applied",
      context?.weather?.extremeReasons.length ? `applied extreme-weather lambda multiplier ${context.weather.lambdaMultiplier}` : "normal or missing weather made no lambda change"
    ]
  };
}

function strongestSide(probabilities: ProbabilitySet): keyof ProbabilitySet {
  return (["home", "draw", "away"] as const).slice().sort((a, b) => probabilities[b] - probabilities[a])[0];
}

function teamAttackDefenseLambdas(match: Fixture, teamInputs: TeamInput[], context: MatchContextInput | null): { xgHome: number; xgAway: number } {
  const home = getTeam(match.home);
  const away = getTeam(match.away);
  const inputMap = new Map(teamInputs.map((row) => [row.teamName, row]));
  const homeAttack = attackIndex(home.recentForm.goalsFor, home.recentForm.matches, home.elo);
  const awayAttack = attackIndex(away.recentForm.goalsFor, away.recentForm.matches, away.elo);
  const homeDefense = defenseIndex(home.recentForm.goalsAgainst, home.recentForm.matches, home.elo);
  const awayDefense = defenseIndex(away.recentForm.goalsAgainst, away.recentForm.matches, away.elo);
  const homeAbsence = absenceMultiplier(context?.squad?.home ?? inputMap.get(match.home));
  const awayAbsence = absenceMultiplier(context?.squad?.away ?? inputMap.get(match.away));
  const eloDiff = (home.elo - away.elo) / 400;
  return {
    xgHome: clamp(1.22 * homeAttack * awayDefense * Math.exp(eloDiff * 0.22) * homeAbsence, 0.18, 4.4),
    xgAway: clamp(1.14 * awayAttack * homeDefense * Math.exp(-eloDiff * 0.22) * awayAbsence, 0.18, 4.4)
  };
}

function attackIndex(goalsFor: number, matches: number, elo: number): number {
  const rate = matches ? goalsFor / matches : 1.35;
  const observed = clamp(rate / 1.45, 0.55, 1.75);
  const longTerm = clamp(Math.exp((elo - 1800) / 900), 0.7, 1.35);
  return 0.55 * longTerm + 0.45 * observed;
}

function defenseIndex(goalsAgainst: number, matches: number, elo: number): number {
  const rate = matches ? goalsAgainst / matches : 1.2;
  const observed = clamp(rate / 1.2, 0.55, 1.75);
  const longTerm = clamp(Math.exp((1800 - elo) / 950), 0.7, 1.35);
  return 0.55 * longTerm + 0.45 * observed;
}

function absenceMultiplier(input: Pick<TeamInput, "keyAbsences" | "injuries" | "suspensions"> | undefined): number {
  if (!input) return 1;
  return clamp(1 - input.keyAbsences * 0.045 - input.injuries * 0.015 - input.suspensions * 0.02, 0.82, 1);
}

function missingContextInputs(context: MatchContextInput | null): string[] {
  return [
    context?.squad?.home.confirmedLineup && context.squad.away.confirmedLineup ? null : "confirmed_lineup",
    context?.squad ? null : "injury_feed",
    context?.weather ? null : "weather",
    context?.weather ? null : "venue"
  ].filter((item): item is string => Boolean(item));
}

function fromLambdas(
  version: ModelVersion,
  home: number | null,
  away: number | null,
  quality: ModelVariantPrediction["marketDataQuality"],
  meta: {
    target: ProbabilitySet | null;
    residual: number | null;
    error: string | null;
    missing: string[];
    rho?: number;
    explanation?: string[];
    components?: { marketHome: number | null; marketAway: number | null; teamHome: number | null; teamAway: number | null };
    context?: MatchContextInput | null;
    missingContext: string[];
  }
): ModelVariantPrediction {
  if (home == null || away == null) {
    return {
      version,
      lambdaHome: null,
      lambdaAway: null,
      lambdaTotal: null,
      lambdaDifference: null,
      probabilities90: meta.target ?? { home: 0, draw: 0, away: 0 },
      topScorelines: [],
      fullScoreMatrix: [],
      probabilityOver25: null,
      probabilityUnder25: null,
      probabilityBttsYes: null,
      probabilityBttsNo: null,
      probabilityExtraTime: null,
      probabilityPenalties: null,
      probabilityHomeAdvance: null,
      probabilityAwayAdvance: null,
      componentLambdas: componentLambdas(meta, null, null),
      marketDataQuality: "missing",
      missingMarketInputs: meta.missing,
      missingContextInputs: meta.missingContext,
      contextInputs: meta.context ?? null,
      solverError: meta.error,
      solverResidual: meta.residual,
      dixonColesRho: meta.rho ?? null,
      confidence: 0,
      explanation: meta.explanation ?? []
    };
  }
  const matrix = scoreMatrix(home, away, meta.rho ?? null);
  const probabilities90 = meta.target ?? outcomeFromMatrix(matrix);
  const top = [...matrix].sort((a, b) => b.probability - a.probability).slice(0, 10).map((row) => ({ score: row.score, probability: row.probability }));
  const extra = probabilities90.draw;
  return {
    version,
    lambdaHome: home,
    lambdaAway: away,
    lambdaTotal: home + away,
    lambdaDifference: home - away,
    probabilities90,
    topScorelines: top,
    fullScoreMatrix: matrix,
    probabilityOver25: matrix.filter((row) => row.home + row.away > 2.5).reduce((sum, row) => sum + row.probability, 0),
    probabilityUnder25: matrix.filter((row) => row.home + row.away < 2.5).reduce((sum, row) => sum + row.probability, 0),
    probabilityBttsYes: matrix.filter((row) => row.home > 0 && row.away > 0).reduce((sum, row) => sum + row.probability, 0),
    probabilityBttsNo: matrix.filter((row) => row.home === 0 || row.away === 0).reduce((sum, row) => sum + row.probability, 0),
    probabilityExtraTime: extra,
    probabilityPenalties: extra * 0.45,
    probabilityHomeAdvance: probabilities90.home + extra * 0.5,
    probabilityAwayAdvance: probabilities90.away + extra * 0.5,
    componentLambdas: componentLambdas(meta, home, away),
    marketDataQuality: quality,
    missingMarketInputs: meta.missing,
    missingContextInputs: meta.missingContext,
    contextInputs: meta.context ?? null,
    solverError: meta.error,
    solverResidual: meta.residual,
    dixonColesRho: meta.rho ?? null,
    confidence: Math.max(probabilities90.home, probabilities90.draw, probabilities90.away),
    explanation: meta.explanation ?? []
  };
}

function componentLambdas(
  meta: { components?: { marketHome: number | null; marketAway: number | null; teamHome: number | null; teamAway: number | null } },
  finalHome: number | null,
  finalAway: number | null
) {
  return {
    marketHome: meta.components?.marketHome ?? null,
    marketAway: meta.components?.marketAway ?? null,
    marketTotal: sumOrNull(meta.components?.marketHome ?? null, meta.components?.marketAway ?? null),
    marketDifference: diffOrNull(meta.components?.marketHome ?? null, meta.components?.marketAway ?? null),
    teamHome: meta.components?.teamHome ?? null,
    teamAway: meta.components?.teamAway ?? null,
    teamTotal: sumOrNull(meta.components?.teamHome ?? null, meta.components?.teamAway ?? null),
    teamDifference: diffOrNull(meta.components?.teamHome ?? null, meta.components?.teamAway ?? null),
    finalHome,
    finalAway,
    finalTotal: sumOrNull(finalHome, finalAway),
    finalDifference: diffOrNull(finalHome, finalAway)
  };
}

function sumOrNull(home: number | null, away: number | null): number | null {
  return home == null || away == null ? null : home + away;
}

function diffOrNull(home: number | null, away: number | null): number | null {
  return home == null || away == null ? null : home - away;
}

export function scoreMatrix(home: number, away: number, rho: number | null): ScoreMatrixCell[] {
  const raw: ScoreMatrixCell[] = [];
  for (let h = 0; h <= 6; h += 1) {
    for (let a = 0; a <= 6; a += 1) {
      const before = scorelineProbability(home, away, h, a);
      raw.push({ score: `${h}-${a}`, home: h, away: a, probabilityBeforeDc: before, probability: before * dixonColesFactor(h, a, home, away, rho) });
    }
  }
  const total = raw.reduce((sum, row) => sum + row.probability, 0);
  return raw.map((row) => ({ ...row, probability: row.probability / total }));
}

function dixonColesFactor(h: number, a: number, home: number, away: number, rho: number | null): number {
  if (rho == null) return 1;
  if (h === 0 && a === 0) return 1 - home * away * rho;
  if (h === 0 && a === 1) return 1 + home * rho;
  if (h === 1 && a === 0) return 1 + away * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function outcomeFromMatrix(matrix: ScoreMatrixCell[]): ProbabilitySet {
  return normalize({
    home: matrix.filter((row) => row.home > row.away).reduce((sum, row) => sum + row.probability, 0),
    draw: matrix.filter((row) => row.home === row.away).reduce((sum, row) => sum + row.probability, 0),
    away: matrix.filter((row) => row.home < row.away).reduce((sum, row) => sum + row.probability, 0)
  });
}

function latestQuote(quotes: OddsQuote[]): OddsQuote | null {
  const sorted = [...quotes].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || quoteCompleteness(a) - quoteCompleteness(b));
  const base = sorted.at(-1);
  if (!base) return null;
  const total = [...sorted].reverse().find((quote) => quote.totalLine != null && quote.overPrice && quote.underPrice);
  const handicap = [...sorted].reverse().find((quote) => quote.handicapLine != null && quote.homeHandicapPrice && quote.awayHandicapPrice);
  const btts = [...sorted].reverse().find((quote) => quote.bttsYesPrice && quote.bttsNoPrice);
  return {
    ...base,
    totalLine: total?.totalLine ?? null,
    overPrice: total?.overPrice ?? null,
    underPrice: total?.underPrice ?? null,
    handicapLine: handicap?.handicapLine ?? null,
    homeHandicapPrice: handicap?.homeHandicapPrice ?? null,
    awayHandicapPrice: handicap?.awayHandicapPrice ?? null,
    bttsYesPrice: btts?.bttsYesPrice ?? null,
    bttsNoPrice: btts?.bttsNoPrice ?? null
  };
}

function quoteCompleteness(quote: OddsQuote): number {
  return Number(quote.totalLine != null && quote.overPrice && quote.underPrice) +
    Number(quote.handicapLine != null && quote.homeHandicapPrice && quote.awayHandicapPrice) +
    Number(quote.bttsYesPrice && quote.bttsNoPrice);
}

function normalize(p: ProbabilitySet): ProbabilitySet {
  const total = p.home + p.draw + p.away;
  return { home: p.home / total, draw: p.draw / total, away: p.away / total };
}

function geometricBlend(market: number, team: number, marketWeight: number): number {
  return Math.exp(marketWeight * Math.log(market) + (1 - marketWeight) * Math.log(team));
}

function squared(value: number): number {
  return value * value;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
