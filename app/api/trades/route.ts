import { NextResponse } from "next/server";

import { fetchPolymarketTrades } from "@/lib/polymarket";

export async function GET() {
  try {
    const data = await fetchPolymarketTrades({ minAmountUSD: 800, limit: 200 });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    throw e;
  }
}
