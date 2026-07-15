import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const logDir = path.join(process.cwd(), ".local");
fs.mkdirSync(logDir, { recursive: true });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const recovery = spawn("node", ["scripts/refresh-results.mjs"], {
  stdio: ["ignore", fs.openSync(path.join(logDir, "start-local-recovery.log"), "a"), fs.openSync(path.join(logDir, "start-local-recovery.err.log"), "a")]
});
recovery.on("exit", (code) => {
  if (code !== 0) console.warn(`startup result recovery failed; site kept running. See .local/start-local-recovery.err.log`);
});

const dev = spawn(npm, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3000"], { stdio: "inherit" });
dev.on("exit", (code) => process.exit(code ?? 0));
