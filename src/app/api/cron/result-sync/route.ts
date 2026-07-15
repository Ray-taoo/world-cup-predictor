import { NextResponse } from "next/server";
import { getD1 } from "@/lib/cloudflare";
import { syncWorkerResults } from "@/lib/cloudflare-result-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "cron secret unavailable" }, { status: 503 });
  const auth = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
    return NextResponse.json({ ok: false, error: "cron secret mismatch" }, { status: 401 });
  }
  const db = await getD1();
  if (!db) return NextResponse.json({ ok: false, error: "D1 binding unavailable" }, { status: 503 });
  try { return NextResponse.json({ ok: true, sync: await syncWorkerResults(db) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "result sync failed" }, { status: 502 }); }
}

export async function POST(request: Request) {
  return GET(request);
}
