"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";

const sample = `matchId,provider,quoteType,marketKind,homeProb,drawProb,awayProb,fetchedAt,sourceUrl
M074,Polymarket,current,prediction_market,0.55,0.24,0.21,2026-06-29T09:00:00.000Z,polymarket-manual
M074,SmartWalletCluster,current,smart_wallet,0.58,0.22,0.20,2026-06-29T09:05:00.000Z,manual-wallet-note`;

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
    setMessage(`已导入 ${body.count} 条赔率/概率记录`);
    router.refresh();
  }

  return (
    <form className="import-form" onSubmit={submit}>
      <p className="muted">
        支持 homePrice/drawPrice/awayPrice，也支持 homeProb/drawProb/awayProb。Polymarket 用 marketKind=prediction_market；链上聪明钱包手动汇总用 marketKind=smart_wallet。
      </p>
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={7} aria-label="赔率 CSV" />
      <button className="primary-button" type="submit">
        <Upload size={16} />
        导入 CSV
      </button>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
