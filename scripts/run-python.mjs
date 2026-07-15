import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/run-python.mjs <script.py> [args...]");
  process.exit(2);
}

const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
let missing = [];
for (const executable of candidates) {
  const result = spawnSync(executable, args, { stdio: "inherit", cwd: process.cwd() });
  if (result.error?.code === "ENOENT") {
    missing.push(executable);
    continue;
  }
  if (result.error) {
    console.error(`${executable} failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error(`Python was not found. Tried: ${missing.join(", ")}`);
process.exit(127);
