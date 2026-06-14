"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RotateCcw, Save } from "lucide-react";

export function MatchOverrideForm({
  matchId,
  currentHome,
  currentAway
}: {
  matchId: string;
  currentHome?: number;
  currentAway?: number;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: Number(form.get("homeScore")),
        awayScore: Number(form.get("awayScore")),
        note: "manual"
      })
    });
    if (!response.ok) {
      const body = await response.json();
      setMessage(body.error ?? "保存失败");
      return;
    }
    setMessage("已保存");
    router.refresh();
  }

  async function reset() {
    const response = await fetch(`/api/overrides?matchId=${encodeURIComponent(matchId)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      setMessage(body.error ?? "恢复失败");
      return;
    }
    setMessage("已恢复预测");
    router.refresh();
  }

  return (
    <form className="override-form" onSubmit={onSubmit}>
      <input name="homeScore" type="number" min="0" max="20" defaultValue={currentHome ?? ""} aria-label="主队比分" />
      <span>:</span>
      <input name="awayScore" type="number" min="0" max="20" defaultValue={currentAway ?? ""} aria-label="客队比分" />
      <button type="submit" className="icon-button" title="保存手动赛果">
        <Save size={15} />
      </button>
      <button type="button" className="icon-button" onClick={reset} title="恢复模型预测">
        <RotateCcw size={15} />
      </button>
      {message ? <span className="form-message">{message}</span> : null}
    </form>
  );
}
