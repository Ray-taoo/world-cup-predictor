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

async function refreshOdds() {
  const response = await fetch(`${siteUrl}/api/odds/refresh`, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `赔率刷新失败：${response.status}`);
  }
  return body;
}

async function main() {
  console.log("1/3 刷新 FIFA 排名和 Transfermarkt 身价");
  run("node", ["scripts/import-free-inputs.mjs"]);
  console.log("2/3 刷新已结束比赛赛果");
  run("node", ["scripts/refresh-results.mjs"]);
  console.log("3/3 刷新 The Odds API 免费赔率");
  const odds = await refreshOdds();
  console.log(JSON.stringify({ oddsImported: odds.count ?? 0, siteUrl }, null, 2));
  console.log("刷新完成。打开 /sources 查看覆盖率。");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
