"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function FullRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    setLoading(true);
    setMessage("正在刷新赛果、球队数据和近期未开赛赔率...");
    try {
      const response = await fetch("/api/local-refresh", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        setMessage(body.error ?? "本地刷新失败，页面已保留现有预测数据。");
        return;
      }
      setMessage(body.started ? "已启动后台刷新，可稍后刷新页面查看最新状态。" : "刷新完成，模型已按最新赛果重算。");
      window.setTimeout(() => router.refresh(), 1500);
    } catch {
      setMessage("本地刷新请求失败，请确认本地站点仍在运行。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-action">
      <button className="primary-button" type="button" onClick={refresh} disabled={loading}>
        <RefreshCw size={16} />
        {loading ? "刷新中..." : "联网刷新并重算模型"}
      </button>
      {message ? <span className="form-message">{message}</span> : null}
    </div>
  );
}
