"use client";

import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { StakeSeed } from "@/lib/selection";
import type { StrategyStat } from "@/lib/risk";
import type { NightlyRefreshState } from "@/lib/nightly-refresh";
import { bttsTradePlan, goalsTradePlan, oneXTwoTradePlan, type ScoreLine, type TradePlan } from "@/lib/trade-plans";

type Side = "home" | "draw" | "away";

interface OutcomeOption {
  side: Side;
  label: "胜" | "平" | "负";
  teamLabel: string;
  price: number | null;
  probability: number;
  marketProbability: number | null;
  edge: number | null;
}

interface MatchForecast {
  seed: StakeSeed;
  outcomes: OutcomeOption[];
  pick: OutcomeOption;
  riskLabel: string;
  riskProbability: number;
  confidence: number;
  upsetRisk: number;
  upsetLevel: "低" | "中" | "高";
  favoriteBlankRisk: number;
  smartMoneyScore: number;
  smartMoneyStatus: StakeSeed["smartMoneyStatus"];
  patternFitScore: number;
  patternFitStatus: StakeSeed["patternFitStatus"];
  marketDriftBadge: string;
  marketDriftClassName: string;
  marketTrendBadge: string;
  marketTrendClassName: string;
  stakeAdvice: string;
  bttsPlan: TradePlan;
  oneXTwoPlan: TradePlan;
  goalsPlan: TradePlan;
  topScores: ScoreLine[];
  reason: string;
}

export function BankrollPlan({
  seeds,
  strategyStats,
  refreshState,
  hybridTopScoresByMatch
}: {
  seeds: StakeSeed[];
  strategyStats: StrategyStat[];
  refreshState: NightlyRefreshState;
  hybridTopScoresByMatch: Record<string, ScoreLine[]>;
}) {
  const forecasts = seeds.slice(0, 8).map((seed) => buildForecast(seed, hybridTopScoresByMatch[seed.matchId] ?? []));
  const highConfidenceStat = strategyStats.find((stat) => stat.threshold.startsWith("60")) ?? strategyStats[0] ?? null;
  const highUpsetCount = forecasts.filter((forecast) => forecast.upsetLevel === "高").length;
  const oddsHealth = oddsHealthText(refreshState);

  return (
    <section className="panel bankroll-panel">
      <div className="section-title-row">
        <div>
          <h2>近期单场胜平负预测</h2>
          <p className="muted">只给每场的胜/平/负方向、预测把握率、前三个可能比分，以及爆冷风险。</p>
          <p className="muted">盘口状态：{oddsHealth}。模型吸收两个思路：单场用攻防 xG 匹配生成比分分布；整届赛事继续用 10,000 次 Monte Carlo 做晋级概率。</p>
        </div>
        <span className={highUpsetCount ? "pill warning" : "pill ok"}>
          <ShieldAlert size={14} />
          爆冷监控 {highUpsetCount} 场
        </span>
      </div>

      <div className="radar-strip">
        <div>
          <span>预测口径</span>
          <strong>单场胜平负</strong>
          <p>只按单场比赛判断，不组合多场方案。</p>
        </div>
        <div>
          <span>回测参考</span>
          <strong>{highConfidenceStat?.matches ? percent(highConfidenceStat.accuracy) : "暂无"}</strong>
          <p>{highConfidenceStat?.matches ? `${highConfidenceStat.threshold} 样本 ${highConfidenceStat.matches} 场` : "等待更多样本"}</p>
        </div>
        <div>
          <span>攻防匹配</span>
          <strong>xG + Poisson</strong>
          <p>用双方预期进球生成 0-0、1-0、1-1 等比分概率。</p>
        </div>
        <div>
          <span>聪明钱</span>
          <strong>Commitment</strong>
          <p>看多源赔率共识、本地 baseline 到当前移动、模型市场同向和价格优势。</p>
        </div>
      </div>

      <div className="daily-buy-board single-forecast-board">
        <div className="daily-buy-head">
          <span>未开赛场次</span>
          <strong>{forecasts.length} 场</strong>
          <span>红色为模型首选方向；黄色风险条表示需要防爆冷。</span>
        </div>
        <div className="forecast-list">
          {!forecasts.length ? (
            <div className="compact-item">
              <span>当前赛程内没有未开赛比赛。导入下一批赛程后这里会自动恢复近期单场预测。</span>
            </div>
          ) : null}
          {forecasts.map((forecast) => (
            <article key={forecast.seed.id} className="forecast-card">
              <div className="forecast-match">
                <strong>{forecast.seed.matchLabel}</strong>
                <span>{forecast.seed.dateLabel}</span>
                <small>{forecast.seed.source}</small>
              </div>
              <div className="forecast-main">
                <div className="daily-outcomes">
                  {forecast.outcomes.map((outcome) => (
                    <OutcomeBox key={outcome.side} outcome={outcome} selected={outcome.side === forecast.pick.side} />
                  ))}
                </div>
                <div className="forecast-summary">
                  <div>
                    <span>预测方向</span>
                    <strong>{forecast.pick.teamLabel}{forecast.pick.label}</strong>
                  </div>
                  <div>
                    <span>把握率</span>
                    <strong>{percent(forecast.confidence)}</strong>
                  </div>
                  <div>
                    <span>主要风险</span>
                    <strong>{forecast.riskLabel}</strong>
                  </div>
                  <div>
                    <span>风险概率</span>
                    <strong>{percent(forecast.riskProbability)}</strong>
                  </div>
                  <div>
                    <span>爆冷风险</span>
                    <strong className={forecast.upsetLevel === "高" ? "edge-negative" : forecast.upsetLevel === "中" ? "edge-neutral" : "edge-positive"}>
                      {forecast.upsetLevel} {percent(forecast.upsetRisk)}
                    </strong>
                  </div>
                  <div>
                    <span>热门零进球风险</span>
                    <strong>{percent(forecast.favoriteBlankRisk)}</strong>
                  </div>
                  <div>
                    <span>聪明钱</span>
                    <strong className={smartMoneyClass(forecast.smartMoneyStatus)}>{forecast.smartMoneyScore}/100</strong>
                  </div>
                  <div>
                    <span>Pattern</span>
                    <strong className={patternFitClass(forecast.patternFitStatus)}>{forecast.patternFitScore}/100</strong>
                  </div>
                  <div>
                    <span>盘口移动</span>
                    <strong className={forecast.marketDriftClassName}>{forecast.marketDriftBadge}</strong>
                  </div>
                  <div>
                    <span>盘口趋势</span>
                    <strong className={forecast.marketTrendClassName}>{forecast.marketTrendBadge}</strong>
                  </div>
                </div>
                <div className={forecast.upsetLevel === "高" ? "upset-note high" : "upset-note"}>
                  <AlertTriangle size={14} />
                  <span>{forecast.reason}</span>
                </div>
                <div className="trade-system-row">
                  <TradePlanBox title="双方进球" plan={forecast.bttsPlan} />
                  <TradePlanBox title="胜平负" plan={forecast.oneXTwoPlan} />
                  <TradePlanBox title="进球数范围" plan={forecast.goalsPlan} />
                </div>
                <div className="pattern-note">
                  <AlertTriangle size={14} />
                  <span>
                    {forecast.seed.patternFitStatus}：{forecast.seed.patternFitText}
                  </span>
                </div>
                <div className="scoreline-row">
                  <span>Hybrid V2 前三比分</span>
                  {forecast.topScores.map((score) => (
                    <strong key={score.score}>{score.score} · {percent(score.probability)}</strong>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="muted risk-copy">
        迭代说明：像“土耳其输给澳大利亚且 0 进球”这种结果，不能只看热门胜率。后续模型会把“热门不胜概率”“热门零进球概率”“盘口是否支持热门”作为降级条件；强队低于 60% 把握率时，不再当作稳胆。
      </p>
    </section>
  );
}

function buildForecast(seed: StakeSeed, topScores: ScoreLine[]): MatchForecast {
  const outcomes = buildOutcomeOptions(seed);
  const pick = [...outcomes].sort((a, b) => b.probability - a.probability)[0];
  const mainRisk = riskPick(seed, pick, outcomes);
  const confidence = pick.probability;
  const upsetRisk = 1 - confidence;
  const favoriteBlankRisk = blankRisk(seed, pick.side);
  const upsetLevel: MatchForecast["upsetLevel"] = upsetRisk >= 0.45 || favoriteBlankRisk >= 0.28 ? "高" : upsetRisk >= 0.34 ? "中" : "低";
  return {
    seed,
    outcomes,
    pick,
    riskLabel: mainRisk.label,
    riskProbability: mainRisk.probability,
    confidence,
    upsetRisk,
    upsetLevel,
    favoriteBlankRisk,
    smartMoneyScore: seed.smartMoneyScore,
    smartMoneyStatus: seed.smartMoneyStatus,
    patternFitScore: seed.patternFitScore,
    patternFitStatus: seed.patternFitStatus,
    marketDriftBadge: marketDriftBadge(seed),
    marketDriftClassName: marketDriftClass(seed.marketDriftStatus),
    marketTrendBadge: marketTrendBadge(seed),
    marketTrendClassName: marketTrendClass(seed.marketTrendStatus),
    stakeAdvice: seed.stakeAdvice,
    bttsPlan: bttsTradePlan(seed),
    oneXTwoPlan: oneXTwoTradePlan(seed),
    goalsPlan: goalsTradePlan(seed),
    topScores,
    reason: upsetReason(seed, pick, upsetRisk, favoriteBlankRisk, upsetLevel)
  };
}

function riskPick(seed: StakeSeed, pick: OutcomeOption, outcomes: OutcomeOption[]): { label: string; probability: number } {
  const risk = outcomes.filter((outcome) => outcome.side !== pick.side).sort((a, b) => b.probability - a.probability)[0];
  if (risk.side === "draw") return { label: "平局风险", probability: risk.probability };
  if (risk.side === "home") return { label: `${seed.homeTeamLabel}反打`, probability: risk.probability };
  return { label: `${seed.awayTeamLabel}反打`, probability: risk.probability };
}

function buildOutcomeOptions(seed: StakeSeed): OutcomeOption[] {
  return [
    {
      side: "home",
      label: "胜",
      teamLabel: seed.homeTeamLabel,
      price: seed.homePrice,
      probability: seed.homeProbability,
      marketProbability: seed.marketHomeProbability,
      edge: diff(seed.homeProbability, seed.marketHomeProbability)
    },
    {
      side: "draw",
      label: "平",
      teamLabel: "平局",
      price: seed.drawPrice,
      probability: seed.drawProbability,
      marketProbability: seed.marketDrawProbability,
      edge: diff(seed.drawProbability, seed.marketDrawProbability)
    },
    {
      side: "away",
      label: "负",
      teamLabel: seed.awayTeamLabel,
      price: seed.awayPrice,
      probability: seed.awayProbability,
      marketProbability: seed.marketAwayProbability,
      edge: diff(seed.awayProbability, seed.marketAwayProbability)
    }
  ];
}

function OutcomeBox({ outcome, selected }: { outcome: OutcomeOption; selected: boolean }) {
  return (
    <div className={selected ? "outcome-box selected" : "outcome-box"}>
      <b>{outcome.label}</b>
      <span>{outcome.teamLabel}</span>
      <strong>{percent(outcome.probability)}</strong>
      <small>赔率 {outcome.price == null ? "--" : outcome.price.toFixed(2)}</small>
      <em className={edgeClass(outcome.edge)}>{outcome.edge == null ? "Edge --" : `Edge ${signedPercent(outcome.edge)}`}</em>
    </div>
  );
}

function TradePlanBox({ title, plan }: { title: string; plan: TradePlan }) {
  return (
    <div className="trade-plan-box">
      <span>{title}</span>
      <strong>{plan.label}</strong>
      <small>{percent(plan.confidence)}</small>
    </div>
  );
}

function poisson(lambda: number, goals: number): number {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function blankRisk(seed: StakeSeed, side: Side): number {
  if (side === "home") return poisson(seed.xgHome, 0);
  if (side === "away") return poisson(seed.xgAway, 0);
  return Math.max(poisson(seed.xgHome, 0), poisson(seed.xgAway, 0));
}

function upsetReason(seed: StakeSeed, pick: OutcomeOption, upsetRisk: number, blank: number, level: MatchForecast["upsetLevel"]): string {
  const attackText = `攻防匹配：${seed.homeTeamLabel} xG ${seed.xgHome.toFixed(2)}，${seed.awayTeamLabel} xG ${seed.xgAway.toFixed(2)}`;
  if (level === "高") {
    return `爆冷风险高。${pick.teamLabel}${pick.label} 是首选，但不胜/反向概率仍有 ${percent(upsetRisk)}，热门零进球风险 ${percent(blank)}。${attackText}。`;
  }
  if (level === "中") {
    return `不是稳胆。${pick.teamLabel}${pick.label} 把握率为 ${percent(pick.probability)}，仍需要防平局或低比分冷门。${attackText}。`;
  }
  return `方向相对清晰。${pick.teamLabel}${pick.label} 把握率 ${percent(pick.probability)}，但赛前仍需核对首发和盘口变化。${attackText}。`;
}

function diff(a: number, b: number | null): number | null {
  return b == null ? null : a - b;
}

function edgeClass(edge: number | null): string {
  if (edge == null) return "edge-neutral";
  if (edge >= 0.025) return "edge-positive";
  if (edge <= -0.035) return "edge-negative";
  return "edge-neutral";
}

function smartMoneyClass(status: StakeSeed["smartMoneyStatus"]): string {
  if (status === "强 commitment" || status === "小注跟随") return "edge-positive";
  if (status === "避开") return "edge-negative";
  return "edge-neutral";
}

function patternFitClass(status: StakeSeed["patternFitStatus"]): string {
  if (status === "pattern支持") return "edge-positive";
  if (status === "pattern反对") return "edge-negative";
  return "edge-neutral";
}

function marketDriftClass(status: StakeSeed["marketDriftStatus"]): string {
  if (status === "顺向") return "edge-positive";
  if (status === "反向") return "edge-negative";
  return "edge-neutral";
}

function marketDriftBadge(seed: StakeSeed): string {
  if (seed.marketDrift == null) return seed.marketDriftStatus;
  const abs = Math.abs(seed.marketDrift);
  const strength = abs >= 0.05 ? "强" : abs >= 0.025 ? "中" : "弱";
  return `${strength}${seed.marketDriftStatus} ${signedPercent(seed.marketDrift)}`;
}

function marketTrendClass(status: StakeSeed["marketTrendStatus"]): string {
  if (status === "持续压向") return "edge-positive";
  if (status === "临场回撤" || status === "持续反向") return "edge-negative";
  return "edge-neutral";
}

function marketTrendBadge(seed: StakeSeed): string {
  if (seed.marketTrendMomentum == null) return seed.marketTrendStatus;
  return `${seed.marketTrendStatus} ${signedPercent(seed.marketTrendMomentum)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percent(value)}`;
}

function oddsHealthText(state: NightlyRefreshState): string {
  if (state.status === "ok") {
    const missing = state.missingOddsMatchIds.length;
    const coverage = `${state.oddsMatchIds.length}/${state.targetMatches || state.oddsMatchIds.length}`;
    return missing
      ? `已刷新 ${coverage} 场，仍缺 ${missing} 场盘口`
      : `已刷新 ${coverage} 场近期盘口`;
  }
  if (state.status === "running") return "正在刷新盘口";
  if (state.status === "error") return `盘口刷新失败，当前用本地已有赔率（${state.error ?? "未知错误"}）`;
  return "尚未执行今日盘口刷新，当前用本地已有赔率";
}
