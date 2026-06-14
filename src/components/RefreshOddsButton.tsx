"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshOddsButton() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/odds/refresh", { method: "POST" });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(friendlyOddsError(body.error ?? "刷新失败"));
      return;
    }
    setMessage(body.count > 0 ? `已刷新 ${body.count} 条赔率` : "已连接免费接口，但当前没有匹配到世界杯 1X2 赔率；可先用 CSV 导入。");
    router.refresh();
  }

  return (
    <div className="inline-action">
      <button className="primary-button" type="button" onClick={refresh} disabled={loading}>
        <RefreshCw size={16} />
        {loading ? "刷新中" : "刷新免费赔率"}
      </button>
      {message ? <span className="form-message">{message}</span> : null}
    </div>
  );
}

function friendlyOddsError(error: string): string {
  if (error.includes("ODDS_API_KEY")) return "还没有填写免费赔率 key。网站仍可运行，也可以先用 CSV 手工导入赔率。";
  if (error.includes("401") || error.includes("403")) return "赔率 key 无效或没有权限，请检查 The Odds API 免费 key。";
  if (error.includes("429") || error.includes("quota") || error.includes("credits")) return "免费额度可能已经用完，稍后再试或先用 CSV 导入。";
  if (error.includes("404")) return "免费接口暂时没有返回世界杯赔率，等赛事临近后再刷新。";
  return `赔率刷新失败：${error}`;
}
