import { NextResponse } from "next/server";
import { buildTradeReport } from "@/lib/trade-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await buildTradeReport();
  return NextResponse.json(report);
}
