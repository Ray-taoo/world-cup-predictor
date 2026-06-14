import { spawnSync } from "node:child_process";

const siteUrl = process.env.LOCAL_SITE_URL ?? "http://127.0.0.1";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function refreshTomorrowOdds() {
  const response = await fetch(`${siteUrl}/api/odds/refresh?scope=tomorrow`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `明日赔率刷新失败：${response.status}`);
  }
  return body;
}

async function main() {
  console.log("1/3 刷新 FIFA 排名和 Transfermarkt 身价");
  run("node", ["scripts/import-free-inputs.mjs"]);
  console.log("2/3 刷新已结束比赛赛果");
  run("node", ["scripts/refresh-results.mjs"]);
  console.log("3/3 只刷新明天场次的 The Odds API 赔率");
  const odds = await refreshTomorrowOdds();
  console.log(JSON.stringify({ oddsImported: odds.count ?? 0, fetched: odds.fetched ?? 0, matchIds: odds.matchIds ?? [], siteUrl }, null, 2));
  console.log("明日数据刷新完成。打开首页查看“明日单场胜平负预测”和赛后复盘。");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
