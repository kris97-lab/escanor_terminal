import { NextResponse } from "next/server";

interface RawTrade {
  id?: string | number | null;
  market_id?: string | number | null;
  market_question?: string | null;
  market_slug?: string | null;
  market?: {
    question?: string | null;
    slug?: string | null;
  } | null;
  outcome?: string | null;
  amount_usdc?: string | number | null;
  created_at?: string | null;
}

interface NormalisedTrade {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  marketSlug: string | null;
  createdAt: string | null;
}

function normaliseTrades(rawTrades: RawTrade[]): NormalisedTrade[] {
  return rawTrades
    .map((raw) => {
      const amountValue = Number(raw.amount_usdc ?? 0);

      if (!Number.isFinite(amountValue) || amountValue < 10_000) {
        return null;
      }

      const marketQuestion =
        typeof raw.market_question === "string" && raw.market_question.length > 0
          ? raw.market_question
          : typeof raw.market?.question === "string" && raw.market?.question.length > 0
          ? raw.market.question
          : "Unknown market";

      const marketIdValue =
        typeof raw.market_id === "string"
          ? raw.market_id
          : typeof raw.market_id === "number"
          ? String(raw.market_id)
          : "";

      if (!marketIdValue) {
        return null;
      }

      const outcomeValue =
        typeof raw.outcome === "string" && raw.outcome.length > 0 ? raw.outcome : "Unknown";

      const slugValue =
        typeof raw.market_slug === "string" && raw.market_slug.length > 0
          ? raw.market_slug
          : typeof raw.market?.slug === "string" && raw.market?.slug.length > 0
          ? raw.market.slug
          : null;

      const idValue =
        typeof raw.id === "string"
          ? raw.id
          : typeof raw.id === "number"
          ? String(raw.id)
          : `${marketIdValue}-${raw.created_at ?? Date.now()}`;

      return {
        id: idValue,
        marketId: marketIdValue,
        marketQuestion,
        outcome: outcomeValue,
        amount: amountValue,
        marketSlug: slugValue,
        createdAt: raw.created_at ?? null,
      } satisfies NormalisedTrade;
    })
    .filter((trade): trade is NormalisedTrade => trade !== null);
}

export async function GET() {
  try {
    const response = await fetch("https://gamma-api.polymarket.com/trades?limit=200", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Gamma API ${response.status}`);
    }

    const json = (await response.json()) as { trades?: RawTrade[] } | RawTrade[];
    const tradesArray = Array.isArray(json)
      ? json
      : Array.isArray(json?.trades)
      ? json.trades
      : [];

    const bigTrades = normaliseTrades(tradesArray);

    return NextResponse.json(bigTrades);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Polymarket trades error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
