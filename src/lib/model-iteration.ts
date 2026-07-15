import { data } from "@/lib/data";
import { predictionForMatch } from "@/lib/model";
import { oddsQuotesByMatchMap } from "@/lib/standings";
import { topScorelines } from "@/lib/trade-plans";
import type { ModelIterationState, ModelReviewRow, OddsQuote, OutcomeKey, OverrideResult, ProbabilitySet, TeamInput } from "@/lib/types";

const minLearningSamples = 6;
let iterationStateCache: { key: string; value: ModelIterationState } | null = null;

export function buildModelIterationState(
  overrides: OverrideResult[],
  odds: OddsQuote[],
  teamInputs: TeamInput[]
): ModelIterationState {
  const cacheKey = JSON.stringify({
    overrides: overrides.map((row) => [row.matchId, row.homeScore, row.awayScore, row.updatedAt]),
    odds: [odds.length, odds[0]?.fetchedAt ?? null],
    teams: teamInputs.map((row) => [row.teamName, row.updatedAt])
  });
  if (iterationStateCache?.key === cacheKey) return iterationStateCache.value;
  const oddsMap = oddsQuotesByMatchMap(odds);
  const rows = overrides
    .map((override) => {
      const match = data.fixtures.find((fixture) => fixture.id === override.matchId);
      if (!match) return null;
      const prediction = predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides });
      const actual = actualOutcome(override);
      const predicted = favoriteSide(prediction.blended);
      const modelFavorite = favoriteSide(prediction.model);
      const marketFavorite = prediction.market ? favoriteSide(prediction.market) : null;
      return { override, prediction, actual, predicted, modelFavorite, marketFavorite };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const sampleSize = rows.length;
  if (!sampleSize) {
    const value = emptyState();
    iterationStateCache = { key: cacheKey, value };
    return value;
  }

  const correct = rows.filter((row) => row.predicted === row.actual).length;
  const accuracy = correct / sampleSize;
  const drawMisses = rows.filter((row) => row.actual === "draw" && row.predicted !== "draw").length;
  const overconfidentWrong = rows.filter((row) => row.predicted !== row.actual && row.prediction.blended[row.predicted] >= 0.6).length;
  const upsetWrong = rows.filter((row) => row.predicted !== row.actual && row.prediction.blended[row.actual] <= 0.25).length;
  const brier = rows.reduce((sum, row) => sum + brierScore(row.prediction.blended, row.actual), 0) / sampleSize;
  const logLoss = rows.reduce((sum, row) => sum - Math.log(Math.max(0.01, row.prediction.blended[row.actual])), 0) / sampleSize;
  const modelFavoriteRows = rows.filter((row) => row.modelFavorite);
  const marketFavoriteRows = rows.filter((row) => row.marketFavorite);
  const modelFavoriteAccuracy = modelFavoriteRows.length
    ? modelFavoriteRows.filter((row) => row.modelFavorite === row.actual).length / modelFavoriteRows.length
    : null;
  const marketFavoriteAccuracy = marketFavoriteRows.length
    ? marketFavoriteRows.filter((row) => row.marketFavorite === row.actual).length / marketFavoriteRows.length
    : null;

  const avgDrawProbability = rows.reduce((sum, row) => sum + row.prediction.blended.draw, 0) / sampleSize;
  const actualDrawRate = rows.filter((row) => row.actual === "draw").length / sampleSize;
  const drawGap = Math.max(0, actualDrawRate - avgDrawProbability);
  const wrongRate = 1 - accuracy;
  const learningScale = sampleSize >= minLearningSamples ? 1 : sampleSize / minLearningSamples;
  const marketWeightShift =
    marketFavoriteAccuracy == null || modelFavoriteAccuracy == null
      ? 0
      : clamp((marketFavoriteAccuracy - modelFavoriteAccuracy) * 0.12, -0.06, 0.06) * learningScale;

  const adjustments = {
    modelTemperature: round3(1 + clamp(wrongRate * 0.22 + (overconfidentWrong / sampleSize) * 0.18, 0, 0.34) * learningScale),
    drawBoost: round3(clamp(drawGap * 0.45 + (drawMisses / sampleSize) * 0.04, 0, 0.1) * learningScale),
    favoriteShrink: round3(clamp((overconfidentWrong / sampleSize) * 0.12 + wrongRate * 0.035, 0, 0.12) * learningScale),
    marketWeightShift: round3(marketWeightShift)
  };

  const value = {
    updatedAt: new Date().toISOString(),
    sampleSize,
    accuracy,
    brier,
    logLoss,
    drawMisses,
    overconfidentWrong,
    upsetWrong,
    modelFavoriteAccuracy,
    marketFavoriteAccuracy,
    adjustments,
    notes: buildNotes(sampleSize, accuracy, drawMisses, overconfidentWrong, upsetWrong, modelFavoriteAccuracy, marketFavoriteAccuracy)
  };
  iterationStateCache = { key: cacheKey, value };
  return value;
}

export function buildModelReviewRows(
  overrides: OverrideResult[],
  odds: OddsQuote[],
  teamInputs: TeamInput[]
): ModelReviewRow[] {
  const oddsMap = oddsQuotesByMatchMap(odds);
  return overrides
    .map((override) => {
      const match = data.fixtures.find((fixture) => fixture.id === override.matchId);
      if (!match) return null;
      const prediction = predictionForMatch(match, oddsMap.get(match.id) ?? null, teamInputs, { disableIteration: true, overrides });
      const actual = actualOutcome(override);
      const predicted = favoriteSide(prediction.blended);
      const modelFavorite = favoriteSide(prediction.model);
      const marketFavorite = prediction.market ? favoriteSide(prediction.market) : null;
      const correct = predicted === actual;
      const predictedProbability = prediction.blended[predicted];
      const actualProbability = prediction.blended[actual];
      const brier = brierScore(prediction.blended, actual);
      const logLoss = -Math.log(Math.max(0.01, actualProbability));
      return {
        matchId: match.id,
        sortDate: match.sortDate,
        home: match.home,
        away: match.away,
        actual,
        predicted,
        modelFavorite,
        marketFavorite,
        correct,
        actualScore: `${override.homeScore}-${override.awayScore}`,
        likelyScore: prediction.likelyScore,
        topScorelines: topScorelines(prediction.xgHome, prediction.xgAway, 3, match.stage === "group" ? predicted : undefined),
        predictedProbability,
        actualProbability,
        brier,
        logLoss,
        providerCount: prediction.marketMeta.providerCount,
        recommendationLevel: prediction.recommendationLevel,
        reflectionType: reflectionType(correct, actual, predictedProbability, actualProbability),
        reflectionDetail: reflectionDetail(correct, actual, predicted, prediction.blended.draw, predictedProbability, actualProbability, prediction.marketMeta.providerCount)
      } satisfies ModelReviewRow;
    })
    .filter((row): row is ModelReviewRow => row != null)
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

export function shouldApplyIteration(state: ModelIterationState | null | undefined): state is ModelIterationState {
  return Boolean(state && state.sampleSize >= minLearningSamples);
}

function emptyState(): ModelIterationState {
  return {
    updatedAt: new Date().toISOString(),
    sampleSize: 0,
    accuracy: 0,
    brier: 0,
    logLoss: 0,
    drawMisses: 0,
    overconfidentWrong: 0,
    upsetWrong: 0,
    modelFavoriteAccuracy: null,
    marketFavoriteAccuracy: null,
    adjustments: {
      modelTemperature: 1,
      drawBoost: 0,
      favoriteShrink: 0,
      marketWeightShift: 0
    },
    notes: ["还没有足够已完赛样本，暂不自动调整模型。"]
  };
}

function buildNotes(
  sampleSize: number,
  accuracy: number,
  drawMisses: number,
  overconfidentWrong: number,
  upsetWrong: number,
  modelFavoriteAccuracy: number | null,
  marketFavoriteAccuracy: number | null
): string[] {
  const notes = [
    `已学习 ${sampleSize} 场已完赛样本，当前首选方向命中率 ${(accuracy * 100).toFixed(1)}%。`
  ];
  if (drawMisses > 0) notes.push(`发现 ${drawMisses} 场平局风险被低估，后续会提高平局保护。`);
  if (overconfidentWrong > 0) notes.push(`发现 ${overconfidentWrong} 场高信心错判，后续会降低热门方过度自信。`);
  if (upsetWrong > 0) notes.push(`发现 ${upsetWrong} 场低概率方向打出，后续会降低“稳胆”推荐门槛。`);
  if (marketFavoriteAccuracy != null && modelFavoriteAccuracy != null) {
    const direction = marketFavoriteAccuracy >= modelFavoriteAccuracy ? "盘口方向暂时更可靠" : "自有模型方向暂时更可靠";
    notes.push(`${direction}，融合权重会按复盘结果小幅调整。`);
  }
  return notes;
}

function actualOutcome(override: OverrideResult): OutcomeKey {
  if (override.homeScore > override.awayScore) return "home";
  if (override.homeScore < override.awayScore) return "away";
  return "draw";
}

function favoriteSide(probs: ProbabilitySet): OutcomeKey {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function brierScore(probs: ProbabilitySet, actual: OutcomeKey): number {
  return ((probs.home - (actual === "home" ? 1 : 0)) ** 2 + (probs.draw - (actual === "draw" ? 1 : 0)) ** 2 + (probs.away - (actual === "away" ? 1 : 0)) ** 2) / 3;
}

function reflectionType(correct: boolean, actual: OutcomeKey, predictedProbability: number, actualProbability: number): ModelReviewRow["reflectionType"] {
  if (correct) return "方向正确";
  if (actual === "draw") return "平局低估";
  if (predictedProbability >= 0.6) return "高信心错判";
  if (actualProbability <= 0.25) return "爆冷错判";
  return "普通错判";
}

function reflectionDetail(
  correct: boolean,
  actual: OutcomeKey,
  predicted: OutcomeKey,
  drawProbability: number,
  predictedProbability: number,
  actualProbability: number,
  providerCount: number
): string {
  if (correct) {
    return `方向命中。保留当前权重，但继续检查前三比分是否覆盖实际比分。`;
  }
  if (actual === "draw") {
    return `实际打平但模型选 ${sideName(predicted)}；赛前平局概率只有 ${(drawProbability * 100).toFixed(1)}%。后续同类比赛提高平局保护，尤其是小组/淘汰赛保守局。`;
  }
  if (predictedProbability >= 0.6) {
    return `高信心错判：模型给首选 ${(predictedProbability * 100).toFixed(1)}%，实际方向只有 ${(actualProbability * 100).toFixed(1)}%。后续降低热门过热和零进球风险。`;
  }
  if (actualProbability <= 0.25) {
    return `低概率方向打出：实际方向赛前只有 ${(actualProbability * 100).toFixed(1)}%。后续复核伤停、轮换、出线动机和盘口反向信号。`;
  }
  if (!providerCount) {
    return `普通错判且缺少盘口源。后续同类比赛需要补充博彩公司或预测市场价格再判断。`;
  }
  return `普通错判。后续降低单一方向置信度，并用前三比分、盘口源和动机因素交叉复核。`;
}

function sideName(side: OutcomeKey): string {
  if (side === "home") return "主胜";
  if (side === "away") return "客胜";
  return "平局";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
