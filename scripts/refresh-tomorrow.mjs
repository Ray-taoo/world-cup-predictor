import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const siteUrl = process.env.LOCAL_SITE_URL ?? "http://127.0.0.1:3000";
const root = process.cwd();
const dataPath = path.join(root, "src", "data", "generated-data.json");
const stateDir = process.env.WORLD_CUP_DATA_DIR ?? path.join(root, ".local");
const nightlyStatePath = path.join(stateDir, "nightly-refresh.json");
const tradeReportPath = path.join(stateDir, "trade-report.json");
const reflectionsPath = path.join(root, "docs", "model-reflections.md");
const snapshotErrorPath = path.join(stateDir, "pre-match-snapshot-error.json");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runOptional(command, args, label) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (label.includes("snapshot") && fs.existsSync(snapshotErrorPath)) fs.rmSync(snapshotErrorPath);
    return true;
  }
  console.warn(`${label} skipped: ${command} ${args.join(" ")} failed with exit code ${result.status}`);
  if (label.includes("snapshot")) writeSnapshotError(command, args, result);
  return false;
}

function writeSnapshotError(command, args, result) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    snapshotErrorPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), command: `${command} ${args.join(" ")}`, exitCode: result.status, stderr: result.stderr, stdout: result.stdout }, null, 2)}\n`,
    "utf8"
  );
}

async function refreshTomorrowOdds() {
  const response = await fetch(`${siteUrl}/api/odds/refresh?scope=tomorrow`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `近期赔率刷新失败：${response.status}`);
  }
  return body;
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log("1/3 刷新 FIFA 排名和 Transfermarkt 身价");
  runOptional("node", ["scripts/import-free-inputs.mjs"], "team input refresh");
  console.log("2/3 刷新已结束比赛赛果");
  runOptional("node", ["scripts/run-python.mjs", "workers/worldcup-sync/src/entry.py", "recent"], "world cup schedule/result sync");
  run("node", ["scripts/refresh-results.mjs"]);
  console.log("3/3 只刷新近期未开赛场次的 The Odds API 赔率");
  const odds = await refreshTomorrowOdds();
  writeNightlyState(startedAt, odds);
  if (runOptional("node", ["scripts/export-trade-report.mjs"], "trade report export")) {
    runOptional("node", ["scripts/capture-prediction-snapshots.mjs"], "pre-match snapshot capture");
    run("node", ["scripts/check-scoreline-direction.mjs"]);
    run("node", ["scripts/check-current-predictions.mjs"]);
    appendReflectionSummary(startedAt);
  }
  console.log(JSON.stringify({ oddsImported: odds.count ?? 0, fetched: odds.fetched ?? 0, matchIds: odds.matchIds ?? [], siteUrl }, null, 2));
  console.log("近期数据刷新完成。打开首页查看“近期单场胜平负预测”、模型自我迭代和赛后复盘。");
}

function appendReflectionSummary(startedAt) {
  if (!fs.existsSync(tradeReportPath)) return;
  const report = JSON.parse(fs.readFileSync(tradeReportPath, "utf8"));
  const day = beijingDateKey(startedAt);
  const p = report.performance ?? {};
  const top = p.topThreeScore ?? {};
  const one = p.successRates?.oneXTwo ?? {};
  const goals = p.successRates?.goals ?? {};
  const btts = p.successRates?.btts ?? {};
  const block = [
    "",
    `## Daily Summary ${day}`,
    "",
    `- 1X2 active signals: ${one.correct ?? 0}/${one.evaluated ?? 0} (${fmtPct(one.accuracy)}).`,
    `- BTTS active signals: ${btts.correct ?? 0}/${btts.evaluated ?? 0} (${fmtPct(btts.accuracy)}).`,
    `- Goals-range active signals: ${goals.correct ?? 0}/${goals.evaluated ?? 0} (${fmtPct(goals.accuracy)}).`,
    `- Top-three scorelines: ${top.correct ?? 0}/${top.evaluated ?? 0} (${fmtPct(top.accuracy)}).`,
    "- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side."
  ].join("\n");
  const current = fs.existsSync(reflectionsPath) ? fs.readFileSync(reflectionsPath, "utf8") : "# Model Reflections\n";
  if (current.includes(`## Daily Summary ${day}`)) return;
  fs.writeFileSync(reflectionsPath, `${current.trimEnd()}\n${block}\n`, "utf8");
}

function fmtPct(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function writeNightlyState(startedAt, odds) {
  const generated = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const targetDates = [
    beijingDateKey(new Date().toISOString()),
    beijingDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
  ];
  const livePath = path.join(root, "src", "data", "live-fixtures.json");
  const live = fs.existsSync(livePath) ? JSON.parse(fs.readFileSync(livePath, "utf8")) : { fixtures: [] };
  const fixtures = [...(generated.fixtures ?? []), ...(live.fixtures ?? [])];
  const targetFixtures = fixtures.filter((match) => targetDates.includes(beijingDateKey(match.sortDate)));
  const oddsMatchIds = Array.isArray(odds.matchIds) ? odds.matchIds : [];
  const missingOddsMatchIds = targetFixtures.map((match) => match.id).filter((matchId) => !oddsMatchIds.includes(matchId));
  const state = {
    status: "ok",
    lastAttemptAt: startedAt,
    lastSuccessAt: new Date().toISOString(),
    beijingRunDate: beijingDateKey(startedAt),
    targetDate: targetDates.join(","),
    targetMatches: targetFixtures.length,
    oddsFetched: odds.fetched ?? 0,
    oddsImported: odds.count ?? 0,
    oddsMatchIds,
    missingOddsMatchIds,
    lineupPendingMatches: targetFixtures.map((match) => match.id),
    note: `本地刷新已完成：已更新赛果，并写入 ${oddsMatchIds.length} 场近期比赛赔率；首发/伤停仍需赛前人工复核。`
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(nightlyStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function writeNightlyError(error) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    nightlyStatePath,
    `${JSON.stringify(
      {
        status: "error",
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: null,
        beijingRunDate: beijingDateKey(new Date().toISOString()),
        targetDate: null,
        targetMatches: 0,
        oddsFetched: 0,
        oddsImported: 0,
        oddsMatchIds: [],
        missingOddsMatchIds: [],
        lineupPendingMatches: [],
        note: "本地刷新失败，请查看 .local/autostart.refresh.log。",
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function beijingDateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

main().catch((error) => {
  writeNightlyError(error);
  console.error(error.message);
  process.exit(1);
});
