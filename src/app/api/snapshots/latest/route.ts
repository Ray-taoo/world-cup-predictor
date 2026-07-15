import { NextResponse } from "next/server";
import { readLatestPredictionSnapshot } from "@/lib/prediction-snapshots";
import type { ModelVersion } from "@/lib/model-variants";

const modelVersions = new Set(["market-only-v1", "baseline-v1-market-elo", "hybrid-v2-knockout"]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId");
  const modelVersion = url.searchParams.get("modelVersion");
  if (!matchId || !modelVersion || !modelVersions.has(modelVersion)) {
    return NextResponse.json({ error: "matchId and modelVersion are required" }, { status: 400 });
  }
  const snapshot = await readLatestPredictionSnapshot(matchId, modelVersion as ModelVersion);
  return NextResponse.json({ snapshot });
}
