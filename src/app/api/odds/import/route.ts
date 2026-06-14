import { NextResponse } from "next/server";
import { insertOdds } from "@/lib/db";
import { parseOddsCsv } from "@/lib/odds";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const csv = String(body.csv ?? "");
  try {
    const quotes = parseOddsCsv(csv);
    const count = await insertOdds(quotes);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSV 导入失败" }, { status: 400 });
  }
}
