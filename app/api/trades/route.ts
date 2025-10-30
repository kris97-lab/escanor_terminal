import { NextResponse } from "next/server";

type PolymarketTrade = {
  amount_usdc?: number | string;
  market_id?: string;
  market?: {
    question?: string;
  } | null;
  outcome?: string;
  maker?: string;
  created_at?: string;
};

type PolymarketApiResponse = {
  trades?: PolymarketTrade[];
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://gamma-api.polymarket.com/trades?limit=100", {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch from Polymarket" },
        { status: response.status },
      );
    }

    const data = (await response.json()) as PolymarketApiResponse;
    if (!data.trades) {
      return NextResponse.json({ error: "Invalid response structure" }, { status: 500 });
    }

    const filtered = data.trades
      .filter((trade) => Number(trade.amount_usdc) > 799)
      .slice(0, 100)
      .map((trade) => ({
        marketId: trade.market_id,
        marketQuestion: trade.market?.question ?? "Unknown market",
        outcome: trade.outcome,
        amount: Number(trade.amount_usdc),
        trader: trade.maker,
        createdAt: trade.created_at,
      }));

    return NextResponse.json(
      { trades: filtered },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      },
    );
  } catch (err: unknown) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Server crashed while fetching Polymarket" }, { status: 500 });
  }
}
