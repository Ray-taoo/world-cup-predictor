import { NextResponse } from "next/server";
import { runNightlyRefresh } from "@/lib/nightly-refresh";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const headerSecret = request.headers.get("x-cron-secret");
    if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
      return NextResponse.json({ ok: false, error: "cron secret mismatch" }, { status: 401 });
    }
  }

  const state = await runNightlyRefresh();
  return NextResponse.json({ ok: state.status === "ok", state }, { status: state.status === "error" ? 502 : 200 });
}

export async function POST(request: Request) {
  return GET(request);
}
