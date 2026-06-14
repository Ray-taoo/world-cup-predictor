import { NextResponse } from "next/server";
import { upsertTeamInputs } from "@/lib/db";
import { parseTeamInputCsv } from "@/lib/team-inputs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const csv = String(body.csv ?? "");
  try {
    const inputs = parseTeamInputCsv(csv);
    const count = await upsertTeamInputs(inputs);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "球队数据导入失败" }, { status: 400 });
  }
}
