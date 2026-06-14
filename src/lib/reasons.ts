import { getTeam } from "@/lib/data";
import { pct } from "@/lib/format";
import { teamName } from "@/lib/i18n";
import type { MatchPrediction } from "@/lib/types";

export function matchReason(prediction: MatchPrediction): string {
  const { match, blended, model, market } = prediction;
  const home = getTeam(match.home);
  const away = getTeam(match.away);
  const favorite =
    blended.home >= blended.draw && blended.home >= blended.away
      ? { label: `${teamName(match.home)}胜`, team: home, prob: blended.home }
      : blended.away >= blended.draw
        ? { label: `${teamName(match.away)}胜`, team: away, prob: blended.away }
        : { label: "平局", team: null, prob: blended.draw };
  const eloDiff = home.elo - away.elo;
  const homeForm = formText(home.recentForm);
  const awayForm = formText(away.recentForm);
  const hostNote = home.isHost
    ? `${teamName(home.name)}有主办国环境加成`
    : away.isHost
      ? `${teamName(away.name)}有主办国环境加成`
      : "按中立场处理";
  const marketNote = market
    ? `${prediction.marketMeta.sourceLabel}已融合，权重 ${pct(prediction.marketMeta.marketWeight)}，共识状态 ${prediction.marketMeta.consensusStatus}，市场倾向为 ${pct(Math.max(market.home, market.draw, market.away))}`
    : "暂无实时盘口，主要看强度分、近期状态和进球分布";
  const inputNote = prediction.explanation.find((line) => line.includes("手工补充数据")) ?? "未导入这两队的手工补充数据";
  const rankNote = prediction.explanation.find((line) => line.includes("FIFA 排名") || line.includes("待导入 FIFA")) ?? "待导入 FIFA 排名";
  const valueNote = prediction.explanation.find((line) => line.includes("身价") || line.includes("待导入球队")) ?? "待导入球队/预计首发身价";
  const absenceNote = prediction.explanation.find((line) => line.includes("缺阵") || line.includes("伤停")) ?? "待导入伤停/停赛数据";
  const dataNote = `${rankNote}；${valueNote}；${absenceNote}`;

  if (favorite.label === "平局") {
    return `倾向平局：双方强度分差距约 ${Math.abs(eloDiff)} 分，模型给平局 ${pct(blended.draw)}；${teamName(home.name)}近10场${homeForm}，${teamName(away.name)}近10场${awayForm}；${hostNote}；${dataNote}；${inputNote}；${marketNote}。`;
  }

  const stronger = eloDiff > 0 ? home : away;
  const weaker = eloDiff > 0 ? away : home;
  const strengthNote =
    Math.abs(eloDiff) >= 120
      ? `${teamName(stronger.name)}强度分明显高于${teamName(weaker.name)}`
      : Math.abs(eloDiff) >= 45
        ? `${teamName(stronger.name)}强度分略占优势`
        : "双方纸面差距不大";
  const scoreNote = `模型预计进球 ${prediction.xgHome.toFixed(2)}:${prediction.xgAway.toFixed(2)}，最可能比分 ${prediction.likelyScore}`;
  const modelNote = `自有模型概率为 ${pct(model.home)}/${pct(model.draw)}/${pct(model.away)}`;
  return `倾向${favorite.label}：${strengthNote}，融合后概率 ${pct(favorite.prob)}；${teamName(home.name)}近10场${homeForm}，${teamName(away.name)}近10场${awayForm}；${hostNote}；${dataNote}；${inputNote}；${scoreNote}；${modelNote}，${marketNote}。`;
}

function formText(form: { wins: number; draws: number; losses: number }): string {
  return `${form.wins}胜${form.draws}平${form.losses}负`;
}
