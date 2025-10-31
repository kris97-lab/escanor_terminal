import { NextResponse } from "next/server";

import { fetchPolymarketTrades } from "@/lib/polymarket";

export async function GET() {
  try {
    const trades = await fetchPolymarketTrades({ minAmountUSD: 10_000, limit: 200 });

    const summary = trades.map((trade) => ({
      id: trade.id,
      marketId: trade.marketId,
      marketQuestion: trade.market,
      outcome: trade.outcome ?? "Unknown",
      amount: trade.amountUSD,
      marketSlug: trade.slug ?? null,
    }));

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Polymarket trades error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
