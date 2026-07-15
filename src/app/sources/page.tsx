import { OddsImportForm } from "@/components/OddsImportForm";
import { RefreshNansenButton } from "@/components/RefreshNansenButton";
import { RefreshPolymarketButton } from "@/components/RefreshPolymarketButton";
import { RefreshOddsButton } from "@/components/RefreshOddsButton";
import { TeamDataImportForm } from "@/components/TeamDataImportForm";
import { data } from "@/lib/data";
import { readOdds, readOverrides, readTeamInputs } from "@/lib/db";
import { dateTime, number } from "@/lib/format";
import { teamName } from "@/lib/i18n";
import {
  isLineupCheckFresh,
  isTeamInputFresh,
  lineupCheckFreshnessText,
  MAX_LINEUP_CHECK_AGE_HOURS,
  MAX_TEAM_INPUT_AGE_DAYS,
  teamInputFreshnessText
} from "@/lib/team-freshness";
import type { OddsQuote } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [overrides, odds, teamInputs] = await Promise.all([readOverrides(), readOdds(), readTeamInputs()]);
  const totalTeams = data.teams.length;
  const fifaCount = teamInputs.filter((input) => input.fifaRank != null).length;
  const marketCount = teamInputs.filter((input) => input.marketValueEurM != null || input.projectedXIValueEurM != null).length;
  const absenceCount = teamInputs.filter((input) => input.injuries + input.suspensions + input.keyAbsences > 0).length;
  const lineupCount = teamInputs.filter(isLineupCheckFresh).length;
  const oddsMatchCount = new Set(odds.map((quote) => quote.matchId)).size;
  const latestTeamInput = [...teamInputs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt;
  const latestOdds = odds[0]?.fetchedAt;

  return (
    <>
      <section className="page-head">
        <div>
          <h1>数据来源与刷新</h1>
          <p>所有内置数据都有来源和抓取时间。免费版没有历史盘口时，页面不会伪造盘口数字。</p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="section-title-row">
          <div>
            <h2>数据补全助手</h2>
            <p className="muted">
              这块用来检查预测模型还缺什么。缺失数据不会自动编造，只会标记为“待导入”。
            </p>
          </div>
          <span className={odds.length && fifaCount && marketCount ? "pill ok" : "pill warning"}>
            {odds.length && fifaCount && marketCount ? "核心数据已导入" : "仍有数据待导入"}
          </span>
        </div>
        <div className="data-source-grid">
          <DataStatusCard
            title="FIFA 排名"
            count={fifaCount}
            total={totalTeams}
            source="FIFA 官方排名"
            status={fifaCount ? "已导入" : "待导入"}
            href="https://inside.fifa.com/fifa-world-ranking/men?dateId=id11230"
            note="用于修正两队基础实力差。导入脚本会选择 FIFA 官方接口中最新的非空完整排名。"
          />
          <DataStatusCard
            title="球队/首发身价"
            count={marketCount}
            total={totalTeams}
            source="Transfermarkt"
            status={marketCount ? "已导入" : "待导入"}
            href="https://www.transfermarkt.co.uk/world-cup/marktwerte/pokalwettbewerb/FIWC"
            note="用于补充纸面阵容质量。身价变化较快，导入时要保留更新时间。"
          />
          <DataStatusCard
            title="伤停/停赛"
            count={absenceCount}
            total={totalTeams}
            source="球队官方/可靠新闻"
            status="后续补充"
            href="https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026"
            note="本版本不从新闻自动猜测缺阵名单；赛前再手工导入可靠伤停和停赛。"
          />
          <DataStatusCard
            title="赔率价格"
            count={oddsMatchCount}
            total={data.fixtures.length}
            source="The Odds API 免费额度 / CSV"
            status={odds.length ? "已接入" : "待导入"}
            href="https://the-odds-api.com/sports/fifa-world-cup-odds.html"
            note={`用于计算去水市场概率和模型相对市场优势。当前共有 ${odds.length} 条赔率记录。`}
          />
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          临场阵容/伤停核对放到后续版本自动化。本版本只在赛前提醒人工确认，不把缺少临场核对当成系统错误。
          最新球队数据：{latestTeamInput ? dateTime(latestTeamInput) : "待导入"}；最新赔率：{latestOdds ? dateTime(latestOdds) : "待导入"}。
        </p>
      </section>

      <section className="grid-2">
        <div className="panel">
          <h2>公开数据快照</h2>
          <div className="source-list">
            {data.sources.map((source) => (
              <div key={source.url} className="source-item">
                <strong>{sourceTitle(source.name)}</strong>
                <p className="muted">{sourceUsage(source.usage)}</p>
                <p>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.url}
                  </a>
                </p>
                <span className="pill">抓取 {dateTime(source.fetchedAt)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>赔率数据</h2>
          <p className="muted">
            配置 `.env.local` 的 `ODDS_API_KEY` 后可以用 The Odds API 免费额度刷新当前世界杯 1X2 赔率；不配置也能用 CSV 手工导入。
            Polymarket 这类预测市场只作为概率参考，页面会和传统博彩公司盘口分开标记。
          </p>
          <RefreshOddsButton />
          <div style={{ height: 10 }} />
          <RefreshPolymarketButton />
          <div style={{ height: 10 }} />
          <RefreshNansenButton />
          <div style={{ height: 14 }} />
          <p className="note">
              使用位置：导入后的 Polymarket 会标记为“预测市场”，聪明钱包 CSV 会标记为“聪明钱包”；两者都会进入近期单场预测、比赛页价格优势、复盘页盘口源和交易报告。聪明钱包自动抓取需要 Nansen/Arkham/Dune 这类数据源的 API Key 或你提供的钱包地址名单。
          </p>
          <div style={{ height: 10 }} />
          <OddsImportForm />
        </div>
      </section>

      <section className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>当前赔率记录</h2>
          <div className="table-wrap">
            <table suppressHydrationWarning>
              <thead>
                <tr>
                  <th>比赛</th>
                  <th>来源</th>
                  <th>类型</th>
                  <th>阶段</th>
                  <th>主/平/客</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {odds.length ? (
                  odds.slice(0, 30).map((quote, index) => (
                    <tr key={`${quote.matchId}-${quote.fetchedAt}-${index}`}>
                      <td>{quote.matchId}</td>
                      <td>{quote.provider}</td>
                      <td>{marketKindLabel(quote.marketKind)}</td>
                      <td>{quoteTypeLabel(quote.quoteType)}</td>
                      <td>
                        {number(quote.homePrice, 2)} / {number(quote.drawPrice, 2)} / {number(quote.awayPrice, 2)}
                      </td>
                      <td>{dateTime(quote.fetchedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>暂无赔率。模型会显示“未接入实时盘口”。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>球队补充数据</h2>
          <p className="muted">
            用于提升模型：FIFA 排名、球队/预计首发身价、伤病、停赛、主力缺阵。没有可靠来源时留空。精选观察区优先使用 {MAX_TEAM_INPUT_AGE_DAYS} 天内更新的数据；临场阵容/伤停核对先作为赛前提醒，后续版本再自动化。
          </p>
          <TeamDataImportForm />
        </div>
      </section>

      <section className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>已导入球队数据</h2>
          <div className="table-wrap">
            <table suppressHydrationWarning>
              <thead>
                <tr>
                  <th>球队</th>
                  <th>FIFA</th>
                  <th>球队身价</th>
                  <th>首发身价</th>
                  <th>缺阵</th>
                  <th>临场核对</th>
                  <th>更新时间</th>
                  <th>新鲜度</th>
                </tr>
              </thead>
              <tbody>
                {teamInputs.length ? (
                  teamInputs.map((input) => (
                    <tr key={input.teamName}>
                      <td className="team">{teamName(input.teamName)}</td>
                      <td>{input.fifaRank ?? "-"}</td>
                      <td>{input.marketValueEurM == null ? "-" : `${number(input.marketValueEurM, 0)} 百万欧`}</td>
                      <td>{input.projectedXIValueEurM == null ? "-" : `${number(input.projectedXIValueEurM, 0)} 百万欧`}</td>
                      <td>{input.injuries + input.suspensions + input.keyAbsences}</td>
                      <td>
                        <span className={isLineupCheckFresh(input) ? "pill ok" : "pill warning"}>{lineupCheckFreshnessText(input)}</span>
                      </td>
                      <td>{dateTime(input.updatedAt)}</td>
                      <td>
                        <span className={isTeamInputFresh(input) ? "pill ok" : "pill warning"}>{teamInputFreshnessText(input)}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>暂无手工球队数据。模型暂只使用内置强度分和近期战绩。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2>赛果锁定记录</h2>
          <p className="muted">自动赛果来自 openfootball/worldcup；如果你手动改过某场比分，自动刷新不会覆盖你的手动记录。</p>
          <div className="table-wrap">
            <table suppressHydrationWarning>
              <thead>
                <tr>
                  <th>比赛</th>
                  <th>比分</th>
                  <th>来源</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {overrides.length ? (
                  overrides.map((row) => (
                    <tr key={row.matchId}>
                      <td>{row.matchId}</td>
                      <td>
                        {row.homeScore}:{row.awayScore}
                      </td>
                      <td>{row.note?.startsWith("自动抓取赛果") ? "自动抓取" : "手动修改"}</td>
                      <td>{dateTime(row.updatedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>暂无已锁定赛果。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p className="note" style={{ marginTop: 16 }}>
        Polymarket 的价格来自预测市场交易，不等同于传统 1X2 博彩盘口；导入后会标记为“预测市场”，只作为融合参考。所有手工数据请保留来源链接和更新时间。
      </p>
      <p className="note" style={{ marginTop: 12 }}>
        关于分享链接：127.0.0.1 和 shijiebeipredict 都是本机地址，发给别人会指向对方自己的电脑，所以打不开。要给别人访问，需要后续做公网部署、临时隧道，或在同一局域网里配置访问。
      </p>
    </>
  );
}

function DataStatusCard({
  title,
  count,
  total,
  source,
  status,
  href,
  note
}: {
  title: string;
  count: number;
  total: number;
  source: string;
  status: string;
  href: string;
  note: string;
}) {
  return (
    <div className="data-source-card">
      <div className="section-title-row">
        <strong>{title}</strong>
        <span className={count ? "pill ok" : "pill warning"}>{status}</span>
      </div>
      <p className="data-count">
        {count}/{total}
      </p>
      <p className="muted">{note}</p>
      <a href={href} target="_blank" rel="noreferrer">
        {source}
      </a>
    </div>
  );
}

function marketKindLabel(kind: OddsQuote["marketKind"]): string {
  if (kind === "smart_wallet") return "聪明钱包";
  return kind === "prediction_market" ? "预测市场" : "博彩公司";
}

function quoteTypeLabel(type: OddsQuote["quoteType"]): string {
  if (type === "opening") return "开盘";
  if (type === "closing") return "临场";
  return "当前";
}

function sourceTitle(name: string): string {
  if (name.includes("2026 schedule")) return "openfootball 世界杯 2026 赛程";
  if (name.includes("international_results")) return "国际比赛历史赛果";
  if (name.includes("historical cups")) return "openfootball 历届世界杯数据";
  return name;
}

function sourceUsage(usage: string): string {
  if (usage.includes("2026 groups")) return "用于 2026 分组和小组赛赛程。";
  if (usage.includes("Elo")) return "用于计算球队强度评分和近期状态。";
  if (usage.includes("2006-2022")) return "用于 2006、2010、2014、2018、2022 五届世界杯回测。";
  return usage;
}
