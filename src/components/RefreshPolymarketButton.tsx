"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshPolymarketButton() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/odds/polymarket/refresh", { method: "POST" });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error ?? "Polymarket 刷新失败");
      return;
    }
    setMessage(
      body.count > 0
        ? `已导入 ${body.count} 条 Polymarket 单场概率`
        : `Polymarket 接口正常；未发现完整单场 1X2，已保存 ${body.strengthCount ?? 0} 条冠军市场强度`
    );
    router.refresh();
  }

  return (
    <div className="inline-action">
      <button className="primary-button" type="button" onClick={refresh} disabled={loading}>
        <RefreshCw size={16} />
        {loading ? "刷新中" : "刷新 Polymarket"}
      </button>
      {message ? <span className="form-message">{message}</span> : null}
    </div>
  );
}
