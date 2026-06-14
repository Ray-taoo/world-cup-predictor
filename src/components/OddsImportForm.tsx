"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";

const sample = `matchId,provider,quoteType,marketKind,homeProb,drawProb,awayProb,fetchedAt,sourceUrl
M001,Polymarket,current,prediction_market,0.52,0.26,0.22,2026-06-05T09:00:00.000Z,polymarket-manual`;

export function OddsImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState(sample);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/odds/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv })
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "导入失败");
      return;
    }
    setMessage(`已导入 ${body.count} 条赔率`);
    router.refresh();
  }

  return (
    <form className="import-form" onSubmit={submit}>
      <p className="muted">
        支持 decimal 赔率字段 homePrice/drawPrice/awayPrice，也支持 Polymarket 这类预测市场概率字段 homeProb/drawProb/awayProb。
      </p>
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={6} aria-label="赔率 CSV" />
      <button className="primary-button" type="submit">
        <Upload size={16} />
        导入 CSV
      </button>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
