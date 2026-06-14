import { data } from "@/lib/data";
import { number, pct } from "@/lib/format";
import { teamName } from "@/lib/i18n";
import { buyingStrategyAuditsFromBacktests, MIN_CONSERVATIVE_EXPECTED_ROI, strategyStatFromBacktests } from "@/lib/risk";

export default function BacktestPage() {
  const avgAccuracy = data.backtests.reduce((sum, row) => sum + row.accuracy, 0) / data.backtests.length;
  const avgBrier = data.backtests.reduce((sum, row) => sum + row.brier, 0) / data.backtests.length;
  const avgLogLoss = data.backtests.reduce((sum, row) => sum + row.logLoss, 0) / data.backtests.length;
  const avgRawAccuracy = data.backtests.reduce((sum, row) => sum + (row.rawAccuracy ?? row.accuracy), 0) / data.backtests.length;
  const avgRawBrier = data.backtests.reduce((sum, row) => sum + (row.rawBrier ?? row.brier), 0) / data.backtests.length;
  const avgRawLogLoss = data.backtests.reduce((sum, row) => sum + (row.rawLogLoss ?? row.logLoss), 0) / data.backtests.length;
  const high55 = strategyStatFromBacktests(data.backtests, "55%+", "highConfidence55Matches", "highConfidence55Accuracy");
  const high60 = strategyStatFromBacktests(data.backtests, "60%+", "highConfidence60Matches", "highConfidence60Accuracy");
  const high70 = aggregateHighConfidence("70%+", "highConfidence70Matches", "highConfidence70Accuracy");
  const overconfident = data.backtests.reduce(
    (sum, row) => ({
      matches: sum.matches + (row.overconfidentMatches ?? 0),
      wrong: sum.wrong + (row.overconfidentWrong ?? 0)
    }),
    { matches: 0, wrong: 0 }
  );
  const strategyRows = [
    { label: "55%+ 高信心", ...high55 },
    { label: "60%+ 严格高信心", ...high60 },
    { label: "70%+ 极高信心", ...high70 }
  ];
  const buyingAudits = buyingStrategyAuditsFromBacktests(data.backtests);

  return (
    <>
      <section className="page-head">
        <div>
          <h1>近 5 届世界杯回测</h1>
          <p>用赛前球队强度分快照预测当届世界杯比赛；页面同时展示原始模型和校准后模型，避免只看单场输赢。</p>
        </div>
      </section>

      <section className="status-strip">
        <div className="metric">
          <span>校准后 1X2 命中率</span>
          <strong>{pct(avgAccuracy)}</strong>
        </div>
        <div className="metric">
          <span>55%+ / 60%+ / 70%+</span>
          <strong>
            {high55.matches ? pct(high55.accuracy) : "暂无"} / {high60.matches ? pct(high60.accuracy) : "暂无"} / {high70.matches ? pct(high70.accuracy) : "暂无"}
          </strong>
        </div>
        <div className="metric">
          <span>平均布赖尔分数</span>
          <strong>{number(avgBrier, 3)}</strong>
        </div>
        <div className="metric">
          <span>高概率错判</span>
          <strong>{overconfident.matches ? `${overconfident.wrong}/${overconfident.matches}` : "暂无"}</strong>
        </div>
      </section>

      <section className="grid-3" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>1X2 命中率</h2>
          <p className="muted">只看最高概率选项是否猜中主胜、平局或客胜。它最直观，但不看概率大小。</p>
        </div>
        <div className="panel">
          <h2>布赖尔分数</h2>
          <p className="muted">衡量概率和真实结果的距离，越低越好。它能惩罚“看对方向但概率给太满”的情况。</p>
        </div>
        <div className="panel">
          <h2>对数损失</h2>
          <p className="muted">越低越好。模型如果对错误结果给了很低概率，会被重罚，所以它更适合检查过度自信。</p>
        </div>
      </section>

      <section className="grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <h2>升级前后对比</h2>
          <div className="table-wrap">
            <table suppressHydrationWarning>
              <thead>
                <tr>
                  <th>模型版本</th>
                  <th>1X2 命中率</th>
                  <th>布赖尔</th>
                  <th>对数损失</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>原始模型</td>
                  <td>{pct(avgRawAccuracy)}</td>
                  <td>{number(avgRawBrier, 3)}</td>
                  <td>{number(avgRawLogLoss, 3)}</td>
                  <td>未做概率温度校准，强队概率可能偏满。</td>
                </tr>
                <tr>
                  <td>校准后模型</td>
                  <td>{pct(avgAccuracy)}</td>
                  <td>{number(avgBrier, 3)}</td>
                  <td>{number(avgLogLoss, 3)}</td>
                  <td>用 2006-2022 回测降低过度自信；当前网站使用此版本。</td>
                </tr>
                <tr>
                  <td>盘口融合模型</td>
                  <td>等待历史盘口</td>
                  <td>等待历史盘口</td>
                  <td>等待历史盘口</td>
                  <td>当前实盘预测已使用多源盘口共识；历史回测没有逐场盘口明细，因此不伪造盘口收益曲线。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>盘口融合状态</h2>
          <p className="muted">{data.calibration?.note ?? "当前数据未写入校准说明。"}</p>
          <div className="compact-list">
            <div className="compact-item">
              <span>基础市场权重</span>
              <strong>{pct(data.calibration?.defaultMarketWeight ?? 0.65)}</strong>
            </div>
            <div className="compact-item">
              <span>当前实盘融合</span>
              <strong>动态权重</strong>
            </div>
            <div className="compact-item">
              <span>历史盘口调参</span>
              <strong>{data.calibration?.optimizedMarketWeight == null ? "等待 CSV" : pct(data.calibration.optimizedMarketWeight)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>过滤策略回测</h2>
          <p className="muted">
          这个表用于“只买确定性最大的几场”的筛选。临界赔率表示在该历史命中率下，长期不亏所需的大致最低 decimal 赔率；保守临界赔率会用回测置信下限再收紧一层。
        </p>
        <div className="strategy-grid">
          {strategyRows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.matches ? pct(row.accuracy) : "暂无"}</strong>
              <p>样本 {row.matches} 场</p>
              <p>保守下限 {row.matches ? pct(row.lowerBound) : "暂无"}</p>
              <p>保守临界赔率 {row.conservativeBreakEvenPrice == null ? "暂无" : number(row.conservativeBreakEvenPrice, 2)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>精选买入策略审计</h2>
        <p className="muted">
          这里用近 5 届世界杯的高信心命中率推导买入门槛。当前没有逐场历史盘口明细，所以这不是历史真实收益曲线；它用于回答“赔率至少要给到多少，才配得上买入”。
          当前安全边际要求为 {pct(MIN_CONSERVATIVE_EXPECTED_ROI)}。
        </p>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>策略池</th>
                <th>历史样本</th>
                <th>命中 / 错误</th>
                <th>历史命中率</th>
                <th>保守胜率</th>
                <th>最低可买赔率</th>
                <th>按门槛价理论收益</th>
                <th>风险提示</th>
              </tr>
            </thead>
            <tbody>
              {buyingAudits.map((audit) => (
                <tr key={audit.threshold}>
                  <td>{audit.label}</td>
                  <td>{audit.matches} 场</td>
                  <td>
                    {audit.correct} / {audit.wrong}
                  </td>
                  <td>{audit.matches ? pct(audit.accuracy) : "暂无"}</td>
                  <td>{audit.matches ? pct(audit.lowerBound) : "暂无"}</td>
                  <td>{audit.minPriceWithMargin == null ? "暂无" : number(audit.minPriceWithMargin, 2)}</td>
                  <td>{audit.historicalRoiAtMinPrice == null ? "暂无" : pct(audit.historicalRoiAtMinPrice)}</td>
                  <td>{audit.sampleWarning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>回测表</h2>
        <div className="table-wrap">
          <table suppressHydrationWarning>
            <thead>
              <tr>
                <th>年份</th>
                <th>冠军</th>
                <th>比赛样本</th>
                <th>原始命中率</th>
                <th>校准命中率</th>
                <th>55%+ 命中</th>
                <th>60%+ 命中</th>
                <th>70%+ 命中</th>
                <th>高概率错判</th>
                <th>布赖尔分数</th>
                <th>对数损失</th>
                <th>赛前冠军概率</th>
              </tr>
            </thead>
            <tbody>
              {data.backtests.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td className="team">{teamName(row.champion)}</td>
                  <td>{row.matches}</td>
                  <td>{pct(row.rawAccuracy ?? row.accuracy)}</td>
                  <td>{pct(row.accuracy)}</td>
                  <td>{formatHigh(row.highConfidence55Matches, row.highConfidence55Accuracy)}</td>
                  <td>{formatHigh(row.highConfidence60Matches, row.highConfidence60Accuracy)}</td>
                  <td>{formatHigh(row.highConfidence70Matches, row.highConfidence70Accuracy)}</td>
                  <td>{row.overconfidentMatches ? `${row.overconfidentWrong ?? 0}/${row.overconfidentMatches}` : "暂无"}</td>
                  <td>{number(row.brier, 3)}</td>
                  <td>{number(row.logLoss, 3)}</td>
                  <td>{pct(row.actualChampionPreTournamentProbability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="note" style={{ marginTop: 16 }}>
        回测用于校准策略，不用于保证未来命中。世界杯样本小、足球低比分随机性强，高信心场次也只能表示“历史上更稳”，不能保证本金增值。
      </p>
    </>
  );

}

function formatHigh(matches: number | undefined, accuracy: number | null | undefined): string {
  if (!matches || accuracy == null) return "暂无";
  return `${pct(accuracy)} / ${matches}场`;
}

function aggregateHighConfidence(
  threshold: string,
  matchesKey: "highConfidence70Matches",
  accuracyKey: "highConfidence70Accuracy"
) {
  let matches = 0;
  let correct = 0;
  for (const row of data.backtests) {
    const rowMatches = row[matchesKey] ?? 0;
    const rowAccuracy = row[accuracyKey];
    if (!rowMatches || rowAccuracy == null) continue;
    matches += rowMatches;
    correct += rowMatches * rowAccuracy;
  }
  const accuracy = matches ? correct / matches : 0;
  return {
    threshold,
    matches,
    accuracy,
    lowerBound: accuracy,
    breakEvenPrice: accuracy > 0 ? 1 / accuracy : null,
    conservativeBreakEvenPrice: accuracy > 0 ? 1 / accuracy : null
  };
}
