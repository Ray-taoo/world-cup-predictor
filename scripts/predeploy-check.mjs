import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const requiredFiles = [
  "README.md",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  ".env.example",
  ".gitignore",
  ".github/workflows/ci.yml",
  ".github/workflows/nightly-refresh.yml",
  "scripts/export-nightly-snapshot.mjs",
  "src/data/generated-data.json",
  "src/data/nightly-snapshot.json"
];

const forbiddenPaths = [".env.local", ".local/worldcup.sqlite", ".next", "node_modules", ".vercel"];
const secretPatterns = [/ODDS_API_KEY\s*=\s*[a-z0-9]{16,}/i, /00598c792b6366bc7e70eed568d35d32/i];

const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) failures.push(`缺少必要文件: ${file}`);
}

const gitignore = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
for (const item of [".env.local", ".local", ".next", "node_modules", ".vercel"]) {
  if (!gitignore.includes(item)) failures.push(`.gitignore 未忽略: ${item}`);
}

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  if (rel.startsWith("node_modules/") || rel.startsWith(".next/") || rel.startsWith(".local/")) continue;
  if (rel === "scripts/predeploy-check.mjs") continue;
  if (!/\.(js|mjs|ts|tsx|json|md|yml|yaml|example|gitignore|css)$/i.test(rel)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) failures.push(`疑似敏感信息泄漏: ${rel}`);
  }
}

const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/nightly-snapshot.json"), "utf8"));
if (!snapshot.state || snapshot.state.status !== "ok") failures.push("nightly-snapshot.json 状态不是 ok");
if (!Array.isArray(snapshot.odds)) failures.push("nightly-snapshot.json 缺少 odds 数组");

for (const command of [
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]]
]) {
  const result = spawnSync(command[0], command[1], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) failures.push(`${command[0]} ${command[1].join(" ")} 失败`);
}

if (failures.length) {
  console.error("\n发布前检查未通过:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\n发布前检查通过。可以推送 GitHub 并导入 Vercel。");

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}
