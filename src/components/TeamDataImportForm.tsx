"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";

const sample = `teamName,fifaRank,marketValueEurM,projectedXIValueEurM,injuries,suspensions,keyAbsences,lineupCheckedAt,updatedAt,sourceUrl
巴西,1,1180,720,1,0,0,,2026-06-05T09:00:00.000Z,https://inside.fifa.com/fifa-world-ranking/men
法国,2,1050,690,0,0,1,,2026-06-05T09:00:00.000Z,https://www.transfermarkt.co.uk/world-cup/marktwerte/pokalwettbewerb/FIWC`;

export function TeamDataImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState(sample);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/team-data/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv })
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "导入失败");
      return;
    }
    setMessage(`已导入 ${body.count} 条球队数据`);
    router.refresh();
  }

  return (
    <form className="import-form" onSubmit={submit}>
      <p className="muted">
        FIFA 排名建议填 FIFA 官方最新排名；球队总身价和预计首发身价建议填 Transfermarkt 数据。临场阵容本版本可留空，赛前再人工核对。
      </p>
      <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={7} aria-label="球队数据 CSV" />
      <button className="primary-button" type="submit">
        <Upload size={16} />
        导入球队数据
      </button>
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
