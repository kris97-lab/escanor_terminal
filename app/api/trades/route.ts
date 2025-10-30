import { NextResponse } from "next/server";

type PolymarketTrade = {
  amount_usdc?: number | string;
  market_id?: string | null;
  market?: {
    question?: string | null;
  } | null;
  outcome?: string | null;
  maker?: string | null;
  created_at?: string | null;
};

type PolymarketApiResponse = {
  trades?: PolymarketTrade[];
};

type NormalizedTrade = {
  marketId: string | null;
  marketQuestion: string;
  outcome: string;
  amount: number;
  trader: string | null;
  createdAt: string;
};

export async function GET() {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/trades?limit=100", {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Polymarket API error" }, { status: res.status, headers: corsHeaders() });
    }

    const data = (await res.json()) as PolymarketApiResponse;

    const trades = (data.trades ?? [])
      .map<NormalizedTrade>((trade) => ({
        marketId: trade.market_id ?? null,
        marketQuestion: trade.market?.question ?? "Unknown market",
        outcome: trade.outcome ?? "Unknown",
        amount: Number(trade.amount_usdc ?? 0),
        trader: trade.maker ?? null,
        createdAt: trade.created_at ?? new Date().toISOString(),
      }))
      .filter((trade) => Number.isFinite(trade.amount) && trade.amount > 799)
      .slice(0, 100);

    return NextResponse.json({ trades }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    console.error("Error fetching Polymarket trades:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
  } satisfies Record<string, string>;
}
