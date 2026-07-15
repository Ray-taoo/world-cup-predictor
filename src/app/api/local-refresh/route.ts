import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.APP_ENV === "production" || process.env.VERCEL) {
    return NextResponse.json({ ok: false, error: "公网部署不执行本地刷新，请使用定时任务刷新。" }, { status: 400 });
  }

  try {
    const origin = new URL(request.url).origin;
    const result = startRefresh(origin);
    return NextResponse.json({ ok: true, started: true, pid: result.pid, log: result.logPath });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "本地刷新启动失败，请稍后重试；页面已保留现有预测数据。" }, { status: 500 });
  }
}

function startRefresh(origin: string): { pid: number | undefined; logPath: string } {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/c", "npm.cmd", "run", "refresh:tomorrow"] : ["run", "refresh:tomorrow"];
  const localDir = path.join(process.cwd(), ".local");
  fs.mkdirSync(localDir, { recursive: true });
  const logPath = path.join(localDir, "manual-refresh.log");
  const errPath = path.join(localDir, "manual-refresh.err.log");
  const statePath = path.join(localDir, "manual-refresh-state.json");
  const current = readRefreshState(statePath);
  if (current?.status === "running" && Date.now() - Date.parse(String(current.startedAt)) < 20 * 60 * 1000) {
    return { pid: typeof current.pid === "number" ? current.pid : undefined, logPath };
  }
  const out = fs.createWriteStream(logPath, { flags: "a" });
  const err = fs.createWriteStream(errPath, { flags: "a" });
  out.write(`\n[${new Date().toISOString()}] manual refresh started\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOCAL_SITE_URL: origin,
      NODE_OPTIONS: "--no-deprecation"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  fs.writeFileSync(statePath, `${JSON.stringify({ status: "running", pid: child.pid, startedAt: new Date().toISOString(), logPath, errPath }, null, 2)}\n`, "utf8");
  child.on("close", (code) => {
    fs.writeFileSync(
      statePath,
      `${JSON.stringify({ status: code === 0 ? "ok" : "error", code, finishedAt: new Date().toISOString(), logPath, errPath }, null, 2)}\n`,
      "utf8"
    );
    out.end(`\n[${new Date().toISOString()}] manual refresh finished with code ${code}\n`);
    err.end();
  });
  child.unref();
  return { pid: child.pid, logPath };
}

function readRefreshState(statePath: string): { status?: string; startedAt?: string; pid?: number } | null {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}
