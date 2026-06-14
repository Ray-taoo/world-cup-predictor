"use client";

import { AlertTriangle, BarChart3, ShieldAlert } from "lucide-react";
import type { StakeSeed } from "@/lib/selection";
import type { StrategyStat } from "@/lib/risk";

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
  insuranceLabel: string;
  insuranceProbability: number;
  insuranceFairPrice: number;
  confidence: number;
  upsetRisk: number;
  upsetLevel: "低" | "中" | "高";
  favoriteBlankRisk: number;
  topScores: ScoreLine[];
  reason: string;
}

interface ScoreLine {
  score: string;
  probability: number;
}

export function BankrollPlan({ seeds, strategyStats }: { seeds: StakeSeed[]; strategyStats: StrategyStat[] }) {
  const forecasts = seeds.slice(0, 8).map(buildForecast);
  const highConfidenceStat = strategyStats.find((stat) => stat.threshold.startsWith("60")) ?? strategyStats[0] ?? null;
  const highUpsetCount = forecasts.filter((forecast) => forecast.upsetLevel === "高").length;

  return (
    <section className="panel bankroll-panel">
      <div className="section-title-row">
        <div>
          <h2>明日单场胜平负预测</h2>
          <p className="muted">取消 2 串 1，只给每场的胜/平/负方向、预测把握率、前三个可能比分，以及爆冷风险。</p>
          <p className="muted">模型吸收两个思路：单场用攻防 xG 匹配生成比分分布；整届赛事继续用 10,000 次 Monte Carlo 做晋级概率。</p>
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
          <p>不再输出 2 串 1，避免两场都对的组合概率过低。</p>
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
          <span>爆冷修正</span>
          <strong>强队不胜风险</strong>
          <p>热门方把握率不够高、或零进球概率偏高时单独标注。</p>
        </div>
      </div>

      <div className="daily-buy-board single-forecast-board">
        <div className="daily-buy-head">
          <span>明日场次</span>
          <strong>{forecasts.length} 场</strong>
          <span>红色为模型首选方向；黄色风险条表示需要防爆冷。</span>
        </div>
        <div className="forecast-list">
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
                    <span>保险买法</span>
                    <strong>{forecast.insuranceLabel}</strong>
                  </div>
                  <div>
                    <span>保险命中率</span>
                    <strong>{percent(forecast.insuranceProbability)}</strong>
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
                </div>
                <div className={forecast.upsetLevel === "高" ? "upset-note high" : "upset-note"}>
                  <AlertTriangle size={14} />
                  <span>{forecast.reason}</span>
                </div>
                <div className="insurance-note">
                  <BarChart3 size={14} />
                  <span>
                    {forecast.insuranceLabel} 覆盖两个结果，命中率高于单买 {forecast.pick.teamLabel}{forecast.pick.label}；
                    但赔率会更低，只有实际赔率高于模型公允赔率 {forecast.insuranceFairPrice.toFixed(2)} 时才算有价格优势。
                  </span>
                </div>
                <div className="scoreline-row">
                  <span>前三比分</span>
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

function buildForecast(seed: StakeSeed): MatchForecast {
  const outcomes = buildOutcomeOptions(seed);
  const pick = [...outcomes].sort((a, b) => b.probability - a.probability)[0];
  const insurance = insurancePick(seed, pick, outcomes);
  const confidence = pick.probability;
  const upsetRisk = 1 - confidence;
  const favoriteBlankRisk = blankRisk(seed, pick.side);
  const upsetLevel: MatchForecast["upsetLevel"] = upsetRisk >= 0.45 || favoriteBlankRisk >= 0.28 ? "高" : upsetRisk >= 0.34 ? "中" : "低";
  return {
    seed,
    outcomes,
    pick,
    insuranceLabel: insurance.label,
    insuranceProbability: insurance.probability,
    insuranceFairPrice: insurance.fairPrice,
    confidence,
    upsetRisk,
    upsetLevel,
    favoriteBlankRisk,
    topScores: topScorelines(seed.xgHome, seed.xgAway, 3),
    reason: upsetReason(seed, pick, upsetRisk, favoriteBlankRisk, upsetLevel)
  };
}

function insurancePick(seed: StakeSeed, pick: OutcomeOption, outcomes: OutcomeOption[]): { label: string; probability: number; fairPrice: number } {
  const home = outcomes.find((outcome) => outcome.side === "home")!;
  const draw = outcomes.find((outcome) => outcome.side === "draw")!;
  const away = outcomes.find((outcome) => outcome.side === "away")!;
  if (pick.side === "away") {
    const probability = away.probability + draw.probability;
    return { label: `${seed.awayTeamLabel}不败（平负）`, probability, fairPrice: 1 / probability };
  }
  if (pick.side === "draw") {
    const stronger = home.probability >= away.probability ? home : away;
    const probability = draw.probability + stronger.probability;
    const label = stronger.side === "home" ? `${seed.homeTeamLabel}不败（胜平）` : `${seed.awayTeamLabel}不败（平负）`;
    return { label, probability, fairPrice: 1 / probability };
  }
  const probability = home.probability + draw.probability;
  return { label: `${seed.homeTeamLabel}不败（胜平）`, probability, fairPrice: 1 / probability };
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

function topScorelines(homeXg: number, awayXg: number, limit: number): ScoreLine[] {
  const rows: ScoreLine[] = [];
  for (let home = 0; home <= 5; home += 1) {
    for (let away = 0; away <= 5; away += 1) {
      let probability = poisson(homeXg, home) * poisson(awayXg, away);
      if ((home === 0 && away === 0) || (home === 1 && away === 1)) probability *= 1.08;
      rows.push({ score: `${home}-${away}`, probability });
    }
  }
  return rows.sort((a, b) => b.probability - a.probability).slice(0, limit);
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

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${percent(value)}`;
}
