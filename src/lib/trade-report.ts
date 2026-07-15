import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { beijingMatchTime } from "@/lib/format";
import { predictionForMatch } from "@/lib/model";
import { buildModelIterationState } from "@/lib/model-iteration";
import { candidateFromPrediction, stakeSeedsFromCandidates, topBuyingCandidates } from "@/lib/selection";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import { bttsTradePlan, goalsTradePlan, oneXTwoTradePlan, topScorelines, type TradeAction } from "@/lib/trade-plans";
import type { MatchPrediction, OddsQuote, OutcomeKey, OverrideResult } from "@/lib/types";

interface AccuracyStat {
  evaluated: number;
  correct: number;
  accuracy: number | null;
}

interface ProfitStat extends AccuracyStat {
  stake: number;
  profit: number;
  roi: number | null;
}

export async function buildTradeReport() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));
  const oddsMap = oddsQuotesByMatchMap(odds);
  const iteration = buildModelIterationState(overrides, odds, teamInputs);
  const allPredictions = data.fixtures
    .map((match) => predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { iteration, overrides }))
    .sort(comparePredictionTime);
  const upcomingPredictions = allPredictions.filter((prediction) => !overrideMap.has(prediction.match.id) && hasNotStarted(prediction));
  const pendingResultPredictions = allPredictions.filter((prediction) => !overrideMap.has(prediction.match.id) && !hasNotStarted(prediction));
  const completedPredictions = allPredictions.filter((prediction) => overrideMap.has(prediction.match.id));
  const nearPredictions = upcomingPredictions.filter(isNearBeijing);
  const planPredictions = nearPredictions.length ? nearPredictions : upcomingPredictions.slice(0, 8);
  const currentSeeds = stakeSeedsFromCandidates(topBuyingCandidates(planPredictions, 48, odds).sort(compareCandidateTime));

  return {
    generatedAt: new Date().toISOString(),
    targetDate: planPredictions[0] ? beijingDateKey(planPredictions[0].match.sortDate) : null,
    completedMatchIds: [...overrideMap.keys()].sort(),
    current: currentSeeds.slice(0, 8).map((seed) => ({
      matchId: seed.matchId,
      side: seed.side,
      matchLabel: seed.matchLabel,
      dateLabel: seed.dateLabel,
      markets: {
        btts: bttsTradePlan(seed),
        oneXTwo: oneXTwoTradePlan(seed),
        goals: goalsTradePlan(seed)
      },
      topScorelines: topScorelines(seed.xgHome, seed.xgAway, 3, seed.side)
    })),
    pendingResults: pendingResultPredictions.map((prediction) => ({
      matchId: prediction.match.id,
      matchLabel: `${prediction.match.home} vs ${prediction.match.away}`,
      kickoffAt: prediction.match.sortDate,
      status: "awaiting_result"
    })),
    marketGaps: marketGaps(planPredictions, oddsMap),
    drawCandidates: currentSeeds.filter(drawCandidate).map((seed) => ({
      matchId: seed.matchId,
      matchLabel: seed.matchLabel,
      drawProbability: seed.drawProbability,
      drawPrice: seed.drawPrice,
      reason: "draw probability high enough and 1X2 favorite gap is small"
    })),
    performance: performanceFromCompleted(completedPredictions, overrideMap, oddsMap),
    note: "successRates 只统计动作为“主选/备选”的方案；“观察/放弃”只记录，不计入交易成功率。blindDrawBenchmark 是每场固定买平局的基准，不是模型推荐。"
  };
}

function performanceFromCompleted(
  predictions: MatchPrediction[],
  overrides: Map<string, OverrideResult>,
  oddsMap: Map<string, OddsQuote[]>
) {
  const btts = emptyStat();
  const oneXTwo = emptyStat();
  const goals = emptyStat();
  const topThreeScore = emptyStat();
  const blindDraw = emptyProfitStat();
  const conditionalDraw = emptyProfitStat();
  const bins = {
    btts: emptyBins(),
    oneXTwo: emptyBins(),
    goals: emptyBins()
  };

  for (const prediction of predictions) {
    const override = overrides.get(prediction.match.id);
    if (!override) continue;
    const seed = stakeSeedsFromCandidates([candidateFromPrediction(prediction, oddsMap.get(prediction.match.id) ?? [])])[0];
    const actualSide = actualOutcomeSide(override);
    const actualBtts = override.homeScore > 0 && override.awayScore > 0 ? "是" : "否";
    const totalGoals = override.homeScore + override.awayScore;
    const actualScore = `${override.homeScore}-${override.awayScore}`;

    const bttsPlan = bttsTradePlan(seed);
    addTradeResult(btts, bttsPlan.action, bttsPlan.label === actualBtts);
    addBinResult(bins.btts, bttsPlan.confidence, bttsPlan.label === actualBtts);
    const oneXTwoPlan = oneXTwoTradePlan(seed);
    addTradeResult(oneXTwo, oneXTwoPlan.action, seed.side === actualSide);
    addBinResult(bins.oneXTwo, seed.probability, seed.side === actualSide);
    const goalsPlan = goalsTradePlan(seed);
    addTradeResult(goals, goalsPlan.action, goalRangeIncludes(goalsPlan.label, totalGoals));
    addBinResult(bins.goals, goalsPlan.confidence, goalRangeIncludes(goalsPlan.label, totalGoals));
    addStat(topThreeScore, topScorelines(seed.xgHome, seed.xgAway, 3, seed.side).some((row) => row.score === actualScore));
    addBlindDrawResult(blindDraw, prediction.odds, actualSide === "draw");
    if (drawCandidate(seed)) addBlindDrawResult(conditionalDraw, prediction.odds, actualSide === "draw");
  }

  return {
    successRates: {
      btts: finalizeStat(btts),
      oneXTwo: finalizeStat(oneXTwo),
      goals: finalizeStat(goals)
    },
    probabilityBins: finalizeBins(bins),
    topThreeScore: finalizeStat(topThreeScore),
    blindDrawBenchmark: finalizeProfitStat(blindDraw),
    conditionalDrawBenchmark: finalizeProfitStat(conditionalDraw)
  };
}

function marketGaps(predictions: MatchPrediction[], oddsMap: Map<string, OddsQuote[]>) {
  return predictions.map((prediction) => {
    const rows = oddsMap.get(prediction.match.id) ?? [];
    const kinds = new Set(rows.map((row) => row.marketKind));
    return {
      matchId: prediction.match.id,
      matchLabel: `${prediction.match.home} vs ${prediction.match.away}`,
      missingSportsbook: !kinds.has("sportsbook"),
      missingPredictionMarket: !kinds.has("prediction_market"),
      missingSmartWallet: !kinds.has("smart_wallet"),
      providers: [...new Set(rows.map((row) => row.provider))]
    };
  });
}

function drawCandidate(seed: { drawProbability: number; probabilityGap: number; drawPrice: number | null }): boolean {
  const impliedDraw = seed.drawPrice ? 1 / seed.drawPrice : null;
  const priceOk = impliedDraw == null || seed.drawProbability > impliedDraw + 0.025;
  return seed.drawProbability >= 0.29 && seed.probabilityGap <= 0.12 && priceOk;
}

function addTradeResult(stat: AccuracyStat, action: TradeAction, correct: boolean): void {
  if (action !== "主选" && action !== "备选") return;
  addStat(stat, correct);
}

function addStat(stat: AccuracyStat, correct: boolean): void {
  stat.evaluated += 1;
  if (correct) stat.correct += 1;
}

function addBlindDrawResult(stat: ProfitStat, odds: OddsQuote | null, correct: boolean): void {
  if (!odds?.drawPrice) return;
  stat.evaluated += 1;
  stat.stake += 1;
  if (correct) {
    stat.correct += 1;
    stat.profit += odds.drawPrice - 1;
  } else {
    stat.profit -= 1;
  }
}

function emptyStat(): AccuracyStat {
  return { evaluated: 0, correct: 0, accuracy: null };
}

function emptyProfitStat(): ProfitStat {
  return { evaluated: 0, correct: 0, accuracy: null, stake: 0, profit: 0, roi: null };
}

function finalizeStat(stat: AccuracyStat): AccuracyStat {
  return {
    evaluated: stat.evaluated,
    correct: stat.correct,
    accuracy: stat.evaluated ? stat.correct / stat.evaluated : null
  };
}

function finalizeProfitStat(stat: ProfitStat): ProfitStat {
  return {
    evaluated: stat.evaluated,
    correct: stat.correct,
    accuracy: stat.evaluated ? stat.correct / stat.evaluated : null,
    stake: stat.stake,
    profit: Number(stat.profit.toFixed(3)),
    roi: stat.stake ? stat.profit / stat.stake : null
  };
}

type BinKey = "50-55" | "55-60" | "60-65" | "65+";
type BinStats = Record<BinKey, AccuracyStat>;

function emptyBins(): BinStats {
  return { "50-55": emptyStat(), "55-60": emptyStat(), "60-65": emptyStat(), "65+": emptyStat() };
}

function addBinResult(bins: BinStats, probability: number, correct: boolean): void {
  const key = probability >= 0.65 ? "65+" : probability >= 0.6 ? "60-65" : probability >= 0.55 ? "55-60" : probability >= 0.5 ? "50-55" : null;
  if (!key) return;
  addStat(bins[key], correct);
}

function finalizeBins(groups: Record<string, BinStats>): Record<string, Record<BinKey, AccuracyStat>> {
  return Object.fromEntries(
    Object.entries(groups).map(([name, bins]) => [name, Object.fromEntries(Object.entries(bins).map(([key, stat]) => [key, finalizeStat(stat)]))])
  ) as Record<string, Record<BinKey, AccuracyStat>>;
}

function goalRangeIncludes(label: string, totalGoals: number): boolean {
  const match = label.match(/(\d+)-(\d+)/);
  if (!match) return false;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return totalGoals >= min && totalGoals <= max;
}

function actualOutcomeSide(override: OverrideResult): OutcomeKey {
  if (override.homeScore > override.awayScore) return "home";
  if (override.homeScore < override.awayScore) return "away";
  return "draw";
}

function comparePredictionTime(a: MatchPrediction, b: MatchPrediction): number {
  return a.match.sortDate.localeCompare(b.match.sortDate) || a.match.matchNumber - b.match.matchNumber;
}

function compareCandidateTime(a: { prediction: MatchPrediction }, b: { prediction: MatchPrediction }): number {
  return a.prediction.match.sortDate.localeCompare(b.prediction.match.sortDate) || a.prediction.match.matchNumber - b.prediction.match.matchNumber;
}

function isNearBeijing(prediction: MatchPrediction): boolean {
  const today = beijingDateKey(new Date().toISOString());
  const tomorrow = beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  const matchDay = beijingDateKey(prediction.match.sortDate);
  return matchDay === today || matchDay === tomorrow;
}

function hasNotStarted(prediction: MatchPrediction): boolean {
  return new Date(prediction.match.sortDate).getTime() > Date.now();
}

function beijingDateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}
