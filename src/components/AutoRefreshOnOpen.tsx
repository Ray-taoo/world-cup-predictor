"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface AutoRefreshOnOpenProps {
  enabled: boolean;
  targetDate: string;
}

export function AutoRefreshOnOpen({ enabled, targetDate }: AutoRefreshOnOpenProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const storageKey = useMemo(() => `worldcup-auto-refresh:${targetDate}`, [targetDate]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const lastRun = window.sessionStorage.getItem(storageKey);
    if (lastRun === "done" || lastRun === "running" || lastRun === "failed") return;

    let cancelled = false;
    window.sessionStorage.setItem(storageKey, "running");
    setStatus("running");

    fetch("/api/local-refresh", { method: "POST" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) {
          throw new Error(body.error ?? "refresh failed");
        }
        if (cancelled) return;
        window.sessionStorage.setItem(storageKey, "done");
        setStatus("done");
        router.refresh();
      })
      .catch(() => {
        if (cancelled) return;
        window.sessionStorage.setItem(storageKey, "failed");
        setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, router, storageKey]);

  if (!enabled && status === "idle") return null;

  return (
    <div className={`auto-refresh-chip ${status === "failed" ? "is-error" : ""}`}>
      <RefreshCw size={14} className={status === "running" ? "spin" : ""} />
      <span>
        {status === "running"
          ? "正在自动刷新赛果、近期赛程和赔率"
          : status === "failed"
            ? "自动刷新失败，可在复盘页手动重试"
            : "已按最新数据重算"}
      </span>
    </div>
  );
}
