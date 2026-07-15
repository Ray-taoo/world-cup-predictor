import { data, getTeam } from "@/lib/data";
import { isOddsFreshForBuying, oddsAgeHours, oddsFreshnessText } from "@/lib/freshness";
import { shouldApplyIteration } from "@/lib/model-iteration";
import { readTeamMarketStrength } from "@/lib/team-market-strength";
import { isLineupCheckFresh, isTeamInputFresh, lineupCheckFreshnessText, teamInputFreshnessText } from "@/lib/team-freshness";
import type { Fixture, GroupId, MarketMeta, MatchPrediction, ModelIterationState, OddsQuote, OverrideResult, ProbabilitySet, TeamInput } from "@/lib/types";

type OddsInput = OddsQuote | OddsQuote[] | null;
interface PredictionOptions {
  iteration?: ModelIterationState | null;
  disableIteration?: boolean;
  overrides?: OverrideResult[];
}

interface GoalAdjustment {
  homeMultiplier: number;
  awayMultiplier: number;
  drawBoost: number;
  note: string | null;
}

export function poisson(lambda: number, k: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i += 1) fact *= i;
  return (Math.exp(-lambda) * lambda ** k) / fact;
}

export function modelProbabilities(
  homeTeam: string,
  awayTeam: string,
  teamInputs: TeamInput[] = [],
  iteration?: ModelIterationState | null,
  goalAdjustment: GoalAdjustment = neutralGoalAdjustment()
): ProbabilitySet & { xgHome: number; xgAway: number } {
  const home = getTeam(homeTeam);
  const away = getTeam(awayTeam);
  const inputMap = new Map(teamInputs.map((input) => [input.teamName, input]));
  const longTermMarket = readTeamMarketStrength();
  const hostBoost = home.isHost ? 42 : 0;
  const manualDiff = manualTeamAdjustment(homeTeam, awayTeam, inputMap) + longTermMarketAdjustment(homeTeam, awayTeam, longTermMarket);
  const diff = (home.elo + hostBoost - away.elo + manualDiff) / 400;
  const formBoost = recentFormBoost(home.name) - recentFormBoost(away.name);
  const confedAdjustment = confederationAdjustment(home.confederation, away.confederation);
  const homeGoals = clamp(1.25 * Math.exp(diff * 0.72 + formBoost + confedAdjustment) * goalAdjustment.homeMultiplier, 0.18, 4.4);
  const awayGoals = clamp(1.16 * Math.exp(-diff * 0.72 - formBoost - confedAdjustment) * goalAdjustment.awayMultiplier, 0.18, 4.4);
  const probs = applyMotivationDrawBoost(applyRuntimeIteration(calibrateProbabilities(scoreProbabilities(homeGoals, awayGoals, goalAdjustment.drawBoost)), iteration), goalAdjustment.drawBoost);
  return { ...probs, xgHome: homeGoals, xgAway: awayGoals };
}

export function scoreProbabilities(homeGoals: number, awayGoals: number, drawBoost = 0): ProbabilitySet {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= 8; h += 1) {
    for (let a = 0; a <= 8; a += 1) {
      const p = scorelineProbability(homeGoals, awayGoals, h, a) * stageScorelineFactor(h, a, drawBoost);
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  return normalize({ home, draw, away });
}

function stageScorelineFactor(homeScore: number, awayScore: number, drawBoost: number): number {
  if (drawBoost < 0.04) return 1;
  if ((homeScore === 0 && awayScore === 0) || (homeScore === 1 && awayScore === 1)) return 1.08;
  if (homeScore + awayScore >= 4 && Math.abs(homeScore - awayScore) >= 2) return 0.86;
  if ((homeScore === 1 && awayScore === 0) || (homeScore === 0 && awayScore === 1)) return 1.04;
  return 1;
}

export function likelyScore(homeGoals: number, awayGoals: number): string {
  let best = { score: "0-0", p: 0 };
  for (let h = 0; h <= 5; h += 1) {
    for (let a = 0; a <= 5; a += 1) {
      const p = scorelineProbability(homeGoals, awayGoals, h, a);
      if (p > best.p) best = { score: `${h}-${a}`, p };
    }
  }
  return best.score;
}

export function scorelineProbability(homeGoals: number, awayGoals: number, homeScore: number, awayScore: number): number {
  return poisson(homeGoals, homeScore) * poisson(awayGoals, awayScore) * scorelineAdjustment(homeGoals, awayGoals, homeScore, awayScore);
}

function scorelineAdjustment(homeGoals: number, awayGoals: number, homeScore: number, awayScore: number): number {
  const minXg = Math.min(homeGoals, awayGoals);
  const totalXg = homeGoals + awayGoals;
  let factor = 1;

  if ((homeScore === 0 && awayScore === 0) || (homeScore === 1 && awayScore === 1)) factor *= 1.06;

  if (minXg >= 0.5 && homeScore > 0 && awayScore > 0) factor *= 1.1;
  if (minXg >= 0.72 && homeScore > 0 && awayScore > 0) factor *= 1.07;

  if (awayScore === 0 && homeScore >= 2 && awayGoals >= 0.5) factor *= 0.72;
  if (homeScore === 0 && awayScore >= 2 && homeGoals >= 0.5) factor *= 0.72;
  if (awayScore === 0 && homeScore === 1 && awayGoals >= 0.85) factor *= 0.9;
  if (homeScore === 0 && awayScore === 1 && homeGoals >= 0.85) factor *= 0.9;

  if (totalXg >= 2.7 && homeScore + awayScore >= 4 && homeScore > 0 && awayScore > 0) factor *= 1.06;
  return factor;
}

export function marketProbabilities(odds: OddsQuote | null): ProbabilitySet | null {
  if (!odds) return null;
  const implied = {
    home: 1 / odds.homePrice,
    draw: 1 / odds.drawPrice,
    away: 1 / odds.awayPrice
  };
  return normalize(implied);
}

export function blendedProbabilities(model: ProbabilitySet, market: ProbabilitySet | null, marketWeight?: number): ProbabilitySet {
  if (!market) return model;
  const weight = marketWeight ?? data.calibration?.defaultMarketWeight ?? 0.65;
  return normalize({
    home: model.home * (1 - weight) + market.home * weight,
    draw: model.draw * (1 - weight) + market.draw * weight,
    away: model.away * (1 - weight) + market.away * weight
  });
}

export function predictionForMatch(
  match: Fixture,
  oddsInput: OddsInput,
  teamInputs: TeamInput[] = [],
  options: PredictionOptions = {}
): MatchPrediction {
  const iteration = options.disableIteration ? null : options.iteration ?? null;
  const motivation = groupMotivationAdjustment(match, options.overrides ?? []);
  const stageAdjustment = stageGoalAdjustment(match, motivation);
  const model = modelProbabilities(match.home, match.away, teamInputs, iteration, stageAdjustment);
  const consensus = oddsConsensus(oddsInput);
  const market = consensus.market;
  const marketMeta = { ...consensus.meta, marketWeight: adjustedMarketWeight(consensus.meta.marketWeight, iteration) };
  const blended = blendedProbabilities(model, market, marketMeta.marketWeight);
  const favorite = [
    [match.home, blended.home],
    ["平局", blended.draw],
    [match.away, blended.away]
  ].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  const topProbability = Number(favorite[1]);
  const homeInput = teamInputs.find((input) => input.teamName === match.home);
  const awayInput = teamInputs.find((input) => input.teamName === match.away);
  const manualDataCoverage = homeInput && awayInput ? "both" : homeInput || awayInput ? "one" : "none";
  const teamDataFreshness = teamDataFreshnessStatus(homeInput, awayInput);
  const lineupCheckFreshness = lineupCheckFreshnessStatus(homeInput, awayInput);
  const dataWarnings = dataQualityWarnings(consensus.representative, manualDataCoverage, teamDataFreshness, lineupCheckFreshness, homeInput, awayInput);
  const explanation = [
    `${match.home} 强度分 ${getTeam(match.home).elo}，${match.away} 强度分 ${getTeam(match.away).elo}`,
    manualRankLine(match.home, match.away, homeInput, awayInput),
    manualValueLine(match.home, match.away, homeInput, awayInput),
    longTermMarketLine(match.home, match.away),
    absenceLine(match.home, match.away, homeInput, awayInput),
    market
      ? `已融合 ${consensus.meta.sourceLabel}，市场权重 ${Math.round(consensus.meta.marketWeight * 100)}%`
      : "未接入实时盘口，仅使用自有模型",
    getTeam(match.home).isHost || getTeam(match.away).isHost ? "主办国球队获得小幅环境修正" : "中立场处理",
    homeInput || awayInput ? `已纳入手工补充数据：${teamInputFreshnessText(homeInput)}；${teamInputFreshnessText(awayInput)}` : "未导入这两队的手工补充数据",
    homeInput || awayInput ? `临场核对：${lineupCheckFreshnessText(homeInput)}；${lineupCheckFreshnessText(awayInput)}` : "未导入临场阵容/伤停核对"
  ];
  if (motivation.note) explanation.push(motivation.note);
  if (stageAdjustment.note && match.stage !== "group") explanation.push(stageAdjustment.note);
  explanation.push(
    shouldApplyIteration(iteration)
      ? `复盘自迭代：已学习 ${iteration.sampleSize} 场，平局保护 +${Math.round(iteration.adjustments.drawBoost * 100)}%，热门降温 ${Math.round(iteration.adjustments.favoriteShrink * 100)}%，盘口权重修正 ${Math.round(iteration.adjustments.marketWeightShift * 100)}%。`
      : "复盘自迭代：样本不足时只记录，不自动改模型权重。"
  );
  return {
    match,
    model: { home: model.home, draw: model.draw, away: model.away },
    market,
    blended,
    xgHome: model.xgHome,
    xgAway: model.xgAway,
    likelyScore: likelyScore(model.xgHome, model.xgAway),
    odds: consensus.representative,
    marketMeta,
    modelIteration: {
      applied: shouldApplyIteration(iteration),
      sampleSize: iteration?.sampleSize ?? 0,
      modelTemperature: iteration?.adjustments.modelTemperature ?? 1,
      drawBoost: iteration?.adjustments.drawBoost ?? 0,
      favoriteShrink: iteration?.adjustments.favoriteShrink ?? 0,
      marketWeightShift: iteration?.adjustments.marketWeightShift ?? 0
    },
    confidenceLabel: topProbability >= 0.55 ? "高" : topProbability >= 0.43 ? "中" : "低",
    recommendationLevel: recommendationLevelForPrediction(blended, model, market, marketMeta),
    confidenceScore: confidenceScore(blended),
    manualDataCoverage,
    teamDataFreshness,
    lineupCheckFreshness,
    dataQualityScore: dataQualityScore(consensus.representative, manualDataCoverage, teamDataFreshness, lineupCheckFreshness),
    dataWarnings,
    explanation
  };
}

function adjustedMarketWeight(weight: number, iteration: ModelIterationState | null): number {
  if (!shouldApplyIteration(iteration)) return weight;
  return clamp(weight + iteration.adjustments.marketWeightShift, 0.18, 0.78);
}

function applyRuntimeIteration(probs: ProbabilitySet, iteration: ModelIterationState | null | undefined): ProbabilitySet {
  if (!shouldApplyIteration(iteration)) return probs;
  let adjusted = temperatureScale(probs, iteration.adjustments.modelTemperature);
  const drawBoost = iteration.adjustments.drawBoost;
  const favorite = favoriteSide(adjusted);
  if (drawBoost > 0 && favorite !== "draw") {
    const other: "home" | "away" = favorite === "home" ? "away" : "home";
    const favoriteCut = Math.min(drawBoost * 0.65, Math.max(0, adjusted[favorite] - 0.34));
    adjusted = normalize({
      home: adjusted.home - (favorite === "home" ? favoriteCut : 0) - (other === "home" ? drawBoost * 0.2 : 0),
      draw: adjusted.draw + drawBoost,
      away: adjusted.away - (favorite === "away" ? favoriteCut : 0) - (other === "away" ? drawBoost * 0.2 : 0)
    });
  }

  const shrink = iteration.adjustments.favoriteShrink;
  const favoriteAfterDraw = favoriteSide(adjusted);
  if (shrink > 0 && favoriteAfterDraw !== "draw") {
    const other: "home" | "away" = favoriteAfterDraw === "home" ? "away" : "home";
    const shift = Math.min(shrink, Math.max(0, adjusted[favoriteAfterDraw] - 0.38));
    adjusted = normalize({
      home: adjusted.home - (favoriteAfterDraw === "home" ? shift : 0) + (other === "home" ? shift * 0.35 : 0),
      draw: adjusted.draw + shift * 0.45,
      away: adjusted.away - (favoriteAfterDraw === "away" ? shift : 0) + (other === "away" ? shift * 0.35 : 0)
    });
  }
  return adjusted;
}

function neutralGoalAdjustment(): GoalAdjustment {
  return { homeMultiplier: 1, awayMultiplier: 1, drawBoost: 0, note: null };
}

function applyMotivationDrawBoost(probs: ProbabilitySet, drawBoost: number): ProbabilitySet {
  if (drawBoost <= 0) return probs;
  const favorite = favoriteSide(probs);
  const other: "home" | "away" = favorite === "home" ? "away" : "home";
  const cut = Math.min(drawBoost, Math.max(0, probs[favorite] - 0.28));
  return normalize({
    home: probs.home - (favorite === "home" ? cut * 0.7 : 0) - (other === "home" ? cut * 0.3 : 0),
    draw: probs.draw + cut,
    away: probs.away - (favorite === "away" ? cut * 0.7 : 0) - (other === "away" ? cut * 0.3 : 0)
  });
}

function groupMotivationAdjustment(match: Fixture, overrides: OverrideResult[]): GoalAdjustment {
  const table = groupTableBefore(match, overrides);
  if (!table) return neutralGoalAdjustment();
  const home = table.find((row) => row.team === match.home);
  const away = table.find((row) => row.team === match.away);
  if (!home || !away || (home.played === 0 && away.played === 0)) return neutralGoalAdjustment();

  const ranked = [...table].sort(compareMotivationRows);
  const homeNeed = qualificationNeed(home, ranked, match);
  const awayNeed = qualificationNeed(away, ranked, match);
  let homeMultiplier = clamp(1 + homeNeed * 0.12, 0.88, 1.14);
  let awayMultiplier = clamp(1 + awayNeed * 0.12, 0.88, 1.14);
  let drawBoost = 0;

  if (homeNeed <= -0.7 && awayNeed <= -0.7) {
    homeMultiplier = 0.9;
    awayMultiplier = 0.9;
    drawBoost = 0.08;
  } else if (bothAdvanceWithDraw(home, away, table, match)) {
    homeMultiplier = 0.93;
    awayMultiplier = 0.93;
    drawBoost = 0.12;
  } else if (homeNeed <= -0.7 || awayNeed <= -0.7) {
    drawBoost = 0.025;
  }

  const note = `小组动机修正：${match.home} ${motivationLabel(homeNeed)}，${match.away} ${motivationLabel(awayNeed)}。`;
  return { homeMultiplier, awayMultiplier, drawBoost, note };
}

function stageGoalAdjustment(match: Fixture, base: GoalAdjustment): GoalAdjustment {
  if (match.stage === "group") return base;
  return {
    homeMultiplier: base.homeMultiplier * 0.94,
    awayMultiplier: base.awayMultiplier * 0.94,
    drawBoost: base.drawBoost + 0.045,
    note: "Knockout 90-min adjustment: lower tempo, higher draw pressure, less trust in big clean-sheet scorelines."
  };
}

interface MotivationRow {
  team: string;
  group: GroupId;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  elo: number;
}

function groupTableBefore(match: Fixture, overrides: OverrideResult[]): MotivationRow[] | null {
  const group = data.groups.find((row) => row.id === match.group);
  if (!group) return null;
  const table = group.teams.map((team) => ({
    team,
    group: group.id,
    played: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    elo: getTeam(team).elo
  }));
  const overrideMap = new Map(overrides.map((row) => [row.matchId, row]));

  for (const prior of data.fixtures.filter((fixture) => fixture.group === match.group && fixture.sortDate < match.sortDate)) {
    const result = overrideMap.get(prior.id);
    if (!result) continue;
    const home = table.find((row) => row.team === prior.home);
    const away = table.find((row) => row.team === prior.away);
    if (!home || !away) continue;
    applyMotivationResult(home, away, result.homeScore, result.awayScore);
  }
  return table;
}

function qualificationNeed(row: MotivationRow, ranked: MotivationRow[], match: Fixture): number {
  const rank = ranked.findIndex((candidate) => candidate.team === row.team) + 1;
  const remainingAfter = data.fixtures.filter(
    (fixture) => fixture.group === match.group && fixture.sortDate > match.sortDate && (fixture.home === row.team || fixture.away === row.team)
  ).length;
  let need = 0;
  if (row.points >= 6 && rank <= 2) need -= 1;
  else if (row.points >= 4 && rank <= 2) need -= 0.45;
  if (row.points <= 1) need += 1;
  else if (row.points <= 3 && rank >= 3) need += 0.75;
  else if (rank >= 3) need += 0.35;
  if (remainingAfter === 0) need += rank <= 2 && row.points >= 4 ? -0.25 : 0.2;
  return clamp(need, -1, 1);
}

function bothAdvanceWithDraw(home: MotivationRow, away: MotivationRow, table: MotivationRow[], match: Fixture): boolean {
  const futureForEither = data.fixtures.some(
    (fixture) =>
      fixture.group === match.group &&
      fixture.sortDate > match.sortDate &&
      (fixture.home === home.team || fixture.away === home.team || fixture.home === away.team || fixture.away === away.team)
  );
  if (futureForEither) return false;
  const projected = table.map((row) => ({ ...row }));
  const projectedHome = projected.find((row) => row.team === home.team);
  const projectedAway = projected.find((row) => row.team === away.team);
  if (!projectedHome || !projectedAway) return false;
  projectedHome.played += 1;
  projectedAway.played += 1;
  projectedHome.points += 1;
  projectedAway.points += 1;
  const ranked = projected.sort(compareMotivationRows);
  const homeRank = ranked.findIndex((row) => row.team === home.team) + 1;
  const awayRank = ranked.findIndex((row) => row.team === away.team) + 1;
  return homeRank > 0 && awayRank > 0 && homeRank <= 2 && awayRank <= 2;
}

function motivationLabel(need: number): string {
  if (need >= 0.65) return "必须抢分";
  if (need >= 0.25) return "仍需主动";
  if (need <= -0.65) return "出线压力低";
  if (need <= -0.25) return "可降节奏";
  return "正常";
}

function applyMotivationResult(home: MotivationRow, away: MotivationRow, homeScore: number, awayScore: number): void {
  home.played += 1;
  away.played += 1;
  home.goalsFor += homeScore;
  home.goalsAgainst += awayScore;
  away.goalsFor += awayScore;
  away.goalsAgainst += homeScore;
  if (homeScore > awayScore) home.points += 3;
  else if (homeScore < awayScore) away.points += 3;
  else {
    home.points += 1;
    away.points += 1;
  }
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
}

function compareMotivationRows(a: MotivationRow, b: MotivationRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return b.elo - a.elo;
}

function temperatureScale(probs: ProbabilitySet, temperature: number): ProbabilitySet {
  if (Math.abs(temperature - 1) < 0.001) return probs;
  return normalize({
    home: probs.home ** (1 / temperature),
    draw: probs.draw ** (1 / temperature),
    away: probs.away ** (1 / temperature)
  });
}

export function calibrateProbabilities(probs: ProbabilitySet): ProbabilitySet {
  const temperature = data.calibration?.modelTemperature ?? 1;
  if (Math.abs(temperature - 1) < 0.001) return probs;
  return normalize({
    home: probs.home ** (1 / temperature),
    draw: probs.draw ** (1 / temperature),
    away: probs.away ** (1 / temperature)
  });
}

export function confidenceScore(probs: ProbabilitySet): number {
  const sorted = [probs.home, probs.draw, probs.away].sort((a, b) => b - a);
  return sorted[0] - sorted[1];
}

export function recommendationLevel(probs: ProbabilitySet): "强推荐" | "谨慎" | "观望" {
  return legacyRecommendationLevel(probs);
}

function legacyRecommendationLevel(probs: ProbabilitySet): "强推荐" | "谨慎" | "观望" {
  const top = Math.max(probs.home, probs.draw, probs.away);
  const gap = confidenceScore(probs);
  if (top >= 0.6 && gap >= 0.16) return "强推荐";
  if (top >= 0.5 && gap >= 0.08) return "谨慎";
  return "观望";
}

function recommendationLevelForPrediction(
  probs: ProbabilitySet,
  model: ProbabilitySet,
  market: ProbabilitySet | null,
  meta: MarketMeta
): MatchPrediction["recommendationLevel"] {
  const top = Math.max(probs.home, probs.draw, probs.away);
  const gap = confidenceScore(probs);
  if (top >= 0.6 && gap >= 0.16) {
    const modelSide = favoriteSide(model);
    const marketSide = market ? favoriteSide(market) : null;
    if (marketSide && modelSide === marketSide && meta.consensusStatus !== "分歧偏大") return "盘口支持强推荐";
    return "模型强盘口弱";
  }
  if (top >= 0.5 && gap >= 0.08 && meta.consensusStatus !== "分歧偏大") return "谨慎";
  return "观望";
}

export function normalize(probs: ProbabilitySet): ProbabilitySet {
  const total = probs.home + probs.draw + probs.away;
  return {
    home: probs.home / total,
    draw: probs.draw / total,
    away: probs.away / total
  };
}

function recentFormBoost(teamName: string): number {
  const team = getTeam(teamName);
  const form = team.recentForm;
  if (!form.matches) return 0;
  const points = form.wins * 3 + form.draws;
  const ppg = points / form.matches;
  const gdPerMatch = (form.goalsFor - form.goalsAgainst) / form.matches;
  return clamp((ppg - 1.35) * 0.025 + gdPerMatch * 0.015, -0.08, 0.08);
}

function manualTeamAdjustment(homeTeam: string, awayTeam: string, inputs: Map<string, TeamInput>): number {
  const home = inputs.get(homeTeam);
  const away = inputs.get(awayTeam);
  let adjustment = 0;
  if (home?.fifaRank && away?.fifaRank) {
    adjustment += clamp((away.fifaRank - home.fifaRank) * 1.65, -70, 70);
  }
  const homeValue = home?.projectedXIValueEurM ?? home?.marketValueEurM ?? null;
  const awayValue = away?.projectedXIValueEurM ?? away?.marketValueEurM ?? null;
  if (homeValue && awayValue && homeValue > 0 && awayValue > 0) {
    adjustment += clamp(Math.log(homeValue / awayValue) * 38, -70, 70);
  }
  adjustment += absencePenalty(away) - absencePenalty(home);
  return clamp(adjustment, -150, 150);
}

function longTermMarketAdjustment(homeTeam: string, awayTeam: string, strengths: Map<string, number>): number {
  const home = strengths.get(homeTeam);
  const away = strengths.get(awayTeam);
  if (!home || !away) return 0;
  return clamp(Math.log(home / away) * 18, -45, 45);
}

function oddsConsensus(input: OddsInput): { representative: OddsQuote | null; market: ProbabilitySet | null; meta: MarketMeta } {
  const quotes = Array.isArray(input) ? input : input ? [input] : [];
  const latestByProvider = latestQuotesByProvider(quotes);
  const usable = latestByProvider.length ? latestByProvider : quotes;
  const representative = bestRepresentativeQuote(usable);
  if (!usable.length || !representative) {
    return {
      representative: null,
      market: null,
      meta: {
        providerCount: 0,
        consensusSpread: null,
        consensusStatus: "缺少盘口",
        marketWeight: 0,
        sourceLabel: "无盘口"
      }
    };
  }

  const probabilities = usable.map(marketProbabilities).filter((value): value is ProbabilitySet => value != null);
  const market = normalize({
    home: median(probabilities.map((row) => row.home)),
    draw: median(probabilities.map((row) => row.draw)),
    away: median(probabilities.map((row) => row.away))
  });
  const spread = maxConsensusSpread(probabilities);
  const providerCount = new Set(usable.map((quote) => quote.provider)).size;
  const consensusStatus: MarketMeta["consensusStatus"] =
    providerCount <= 1 ? "单一来源" : spread != null && spread <= 0.05 ? "多源一致" : "分歧偏大";
  const marketWeight = dynamicMarketWeight(representative, consensusStatus, providerCount, spread);

  return {
    representative,
    market,
    meta: {
      providerCount,
      consensusSpread: spread,
      consensusStatus,
      marketWeight,
      sourceLabel: providerCount > 1 ? `${providerCount} 家盘口共识` : `${representative.provider} 单一盘口`
    }
  };
}

function latestQuotesByProvider(quotes: OddsQuote[]): OddsQuote[] {
  const latest = new Map<string, OddsQuote>();
  for (const quote of quotes.filter((row) => row.quoteType !== "opening")) {
    const current = latest.get(quote.provider);
    if (!current || compareQuoteFreshness(quote, current) > 0) latest.set(quote.provider, quote);
  }
  return [...latest.values()];
}

function bestRepresentativeQuote(quotes: OddsQuote[]): OddsQuote | null {
  return [...quotes].sort(compareQuoteFreshness).at(-1) ?? null;
}

function compareQuoteFreshness(a: OddsQuote, b: OddsQuote): number {
  const quotePriority: Record<OddsQuote["quoteType"], number> = { closing: 3, current: 2, opening: 1 };
  const priorityDiff = quotePriority[a.quoteType] - quotePriority[b.quoteType];
  if (priorityDiff !== 0) return priorityDiff;
  return a.fetchedAt.localeCompare(b.fetchedAt);
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function maxConsensusSpread(values: ProbabilitySet[]): number | null {
  if (values.length < 2) return null;
  return Math.max(
    range(values.map((row) => row.home)),
    range(values.map((row) => row.draw)),
    range(values.map((row) => row.away))
  );
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function dynamicMarketWeight(
  representative: OddsQuote,
  status: MarketMeta["consensusStatus"],
  providerCount: number,
  spread: number | null
): number {
  let weight = data.calibration?.defaultMarketWeight ?? 0.65;
  if (status === "多源一致") weight += 0.06;
  if (status === "单一来源") weight -= 0.18;
  if (status === "分歧偏大") weight -= 0.28;
  if (providerCount >= 10) weight += 0.03;
  if (spread != null && spread <= 0.025) weight += 0.03;
  if (!isOddsFreshForBuying(representative)) weight -= 0.18;
  const age = oddsAgeHours(representative);
  if (age != null && age <= 12) weight += 0.02;
  return clamp(weight, 0.25, 0.74);
}

function favoriteSide(probs: ProbabilitySet): "home" | "draw" | "away" {
  if (probs.home >= probs.draw && probs.home >= probs.away) return "home";
  if (probs.away >= probs.draw) return "away";
  return "draw";
}

function absencePenalty(input: TeamInput | undefined): number {
  if (!input) return 0;
  return input.injuries * 5 + input.suspensions * 12 + input.keyAbsences * 18;
}

function confederationAdjustment(home: string, away: string): number {
  if (home === away) return 0;
  const weight: Record<string, number> = {
    UEFA: 0.018,
    CONMEBOL: 0.016,
    CONCACAF: 0.004,
    CAF: 0.002,
    AFC: 0,
    OFC: -0.01
  };
  return (weight[home] ?? 0) - (weight[away] ?? 0);
}

function dataQualityScore(
  odds: OddsQuote | null,
  manualDataCoverage: MatchPrediction["manualDataCoverage"],
  teamDataFreshness: MatchPrediction["teamDataFreshness"],
  lineupCheckFreshness: MatchPrediction["lineupCheckFreshness"]
): number {
  let score = 0;
  if (odds) score += 42;
  if (odds?.quoteType === "closing") score += 18;
  else if (odds?.quoteType === "current") score += 12;
  else if (odds?.quoteType === "opening") score += 6;
  if (manualDataCoverage === "both") score += 32;
  else if (manualDataCoverage === "one") score += 16;
  if (odds?.marketKind === "sportsbook") score += 8;
  else if (odds?.marketKind === "prediction_market") score += 5;
  else if (odds?.marketKind === "smart_wallet") score += 4;
  if (odds && !isOddsFreshForBuying(odds)) score -= 22;
  if (teamDataFreshness === "partial") score -= 12;
  if (teamDataFreshness === "stale") score -= 26;
  if (lineupCheckFreshness === "fresh") score += 2;
  return Math.min(100, Math.max(0, score));
}

function dataQualityWarnings(
  odds: OddsQuote | null,
  manualDataCoverage: MatchPrediction["manualDataCoverage"],
  teamDataFreshness: MatchPrediction["teamDataFreshness"],
  lineupCheckFreshness: MatchPrediction["lineupCheckFreshness"],
  homeInput: TeamInput | undefined,
  awayInput: TeamInput | undefined
): string[] {
  const warnings: string[] = [];
  if (!odds) warnings.push("缺少盘口或预测市场价格");
  else if (odds.quoteType === "opening") warnings.push("只有开盘价，缺少当前或临场价格");
  if (odds && !isOddsFreshForBuying(odds)) warnings.push(oddsFreshnessText(odds));
  if (manualDataCoverage === "none") warnings.push("两队都未导入 FIFA 排名、身价或伤停补充数据");
  if (manualDataCoverage === "one") warnings.push("只有一队有手工补充数据");
  if (teamDataFreshness === "partial") warnings.push(`只有一队补充数据在 ${MAX_TEAM_INPUT_AGE_TEXT} 内更新`);
  if (teamDataFreshness === "stale") warnings.push(`${teamInputFreshnessText(homeInput)}；${teamInputFreshnessText(awayInput)}`);
  if (lineupCheckFreshness === "missing") warnings.push("临场阵容/伤停待赛前人工核对");
  if (lineupCheckFreshness === "partial") warnings.push("只有一队完成临场核对，赛前需复核");
  if (lineupCheckFreshness === "stale") warnings.push("临场阵容/伤停核对已过期，赛前需复核");
  return warnings;
}

const MAX_TEAM_INPUT_AGE_TEXT = "14 天";

function teamDataFreshnessStatus(homeInput: TeamInput | undefined, awayInput: TeamInput | undefined): MatchPrediction["teamDataFreshness"] {
  if (!homeInput && !awayInput) return "missing";
  const homeFresh = isTeamInputFresh(homeInput);
  const awayFresh = isTeamInputFresh(awayInput);
  if (homeFresh && awayFresh) return "fresh";
  if (homeFresh || awayFresh) return "partial";
  return "stale";
}

function lineupCheckFreshnessStatus(homeInput: TeamInput | undefined, awayInput: TeamInput | undefined): MatchPrediction["lineupCheckFreshness"] {
  if (!homeInput && !awayInput) return "missing";
  if (!homeInput?.lineupCheckedAt && !awayInput?.lineupCheckedAt) return "missing";
  const homeFresh = isLineupCheckFresh(homeInput);
  const awayFresh = isLineupCheckFresh(awayInput);
  if (homeFresh && awayFresh) return "fresh";
  if (homeFresh || awayFresh) return "partial";
  return "stale";
}

function manualRankLine(homeTeam: string, awayTeam: string, homeInput: TeamInput | undefined, awayInput: TeamInput | undefined): string {
  if (homeInput?.fifaRank && awayInput?.fifaRank) {
    return `FIFA 排名：${homeTeam}第 ${homeInput.fifaRank}，${awayTeam}第 ${awayInput.fifaRank}`;
  }
  if (homeInput?.fifaRank || awayInput?.fifaRank) return "FIFA 排名只导入了一队，暂不完整";
  return "待导入 FIFA 排名";
}

function manualValueLine(homeTeam: string, awayTeam: string, homeInput: TeamInput | undefined, awayInput: TeamInput | undefined): string {
  const homeValue = homeInput?.projectedXIValueEurM ?? homeInput?.marketValueEurM ?? null;
  const awayValue = awayInput?.projectedXIValueEurM ?? awayInput?.marketValueEurM ?? null;
  if (homeValue != null && awayValue != null) {
    return `身价参考：${homeTeam}约 ${Math.round(homeValue)} 百万欧，${awayTeam}约 ${Math.round(awayValue)} 百万欧`;
  }
  if (homeValue != null || awayValue != null) return "身价数据只导入了一队，暂不完整";
  return "待导入球队/预计首发身价";
}

function longTermMarketLine(homeTeam: string, awayTeam: string): string {
  const strengths = readTeamMarketStrength();
  const home = strengths.get(homeTeam);
  const away = strengths.get(awayTeam);
  if (!home || !away) return "Long-term winner market strength pending";
  return `Long-term winner market strength: ${homeTeam} ${(home * 100).toFixed(1)}%, ${awayTeam} ${(away * 100).toFixed(1)}%`;
}
function absenceLine(homeTeam: string, awayTeam: string, homeInput: TeamInput | undefined, awayInput: TeamInput | undefined): string {
  if (homeInput || awayInput) {
    const homeAbsences = absenceCount(homeInput);
    const awayAbsences = absenceCount(awayInput);
    return `缺阵记录：${homeTeam} ${homeAbsences} 人，${awayTeam} ${awayAbsences} 人`;
  }
  return "待导入伤停/停赛数据";
}

function absenceCount(input: TeamInput | undefined): number {
  if (!input) return 0;
  return input.injuries + input.suspensions + input.keyAbsences;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
