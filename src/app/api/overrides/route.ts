import { NextResponse } from "next/server";
import { data } from "@/lib/data";
import { deleteOverride, saveOverride } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const matchId = String(body.matchId ?? "");
  const homeScore = Number(body.homeScore);
  const awayScore = Number(body.awayScore);
  const note = body.note == null ? null : String(body.note);
  if (!data.fixtures.some((match) => match.id === matchId)) {
    return NextResponse.json({ error: "找不到比赛 ID" }, { status: 400 });
  }
  if (![homeScore, awayScore].every((score) => Number.isInteger(score) && score >= 0 && score <= 20)) {
    return NextResponse.json({ error: "比分必须是 0 到 20 的整数" }, { status: 400 });
  }
  await saveOverride({ matchId, homeScore, awayScore, note });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  if (!matchId) {
    return NextResponse.json({ error: "缺少 matchId" }, { status: 400 });
  }
  await deleteOverride(matchId);
  return NextResponse.json({ ok: true });
}
