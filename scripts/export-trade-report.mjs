import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const siteUrl = process.env.WORLDCUP_SITE_URL ?? "http://127.0.0.1:3000";
const outputPath = path.join(process.cwd(), ".local", "trade-report.json");

const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/trade-report`, { cache: "no-store" });
if (!response.ok) {
  throw new Error(`Trade report request failed: ${response.status} ${response.statusText}`);
}

const report = await response.json();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const stats = report.performance?.successRates ?? {};
const topThree = report.performance?.topThreeScore;
const draw = report.performance?.blindDrawBenchmark;
console.log(`Wrote ${outputPath}`);
console.log(`BTTS: ${formatStat(stats.btts)} | 1X2: ${formatStat(stats.oneXTwo)} | Goals: ${formatStat(stats.goals)}`);
console.log(`Top-three score: ${formatStat(topThree)} | Blind draw ROI: ${draw?.roi == null ? "--" : `${(draw.roi * 100).toFixed(1)}%`}`);

function formatStat(stat) {
  if (!stat || !stat.evaluated) return "0/0 --";
  return `${stat.correct}/${stat.evaluated} ${(stat.accuracy * 100).toFixed(1)}%`;
}
