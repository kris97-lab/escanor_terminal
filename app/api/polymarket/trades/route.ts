import { NextResponse } from "next/server";

type GammaTrade = {
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
};

type DataTrade = {
  transactionHash?: string | null;
  conditionId?: string | null;
  timestamp?: number | null;
  price?: number | string | null;
  size?: number | string | null;
  outcome?: string | null;
  title?: string | null;
  asset?: string | null;
  slug?: string | null;
  eventSlug?: string | null;
};

type NormalisedTrade = {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  marketSlug: string | null;
  createdAt: string | null;
};

const MIN_AMOUNT = 10_000;

function normaliseGammaTrades(rawTrades: GammaTrade[]): NormalisedTrade[] {
  return rawTrades
    .map((raw) => {
      const amountValue = Number(raw.amount_usdc ?? 0);

      if (!Number.isFinite(amountValue) || amountValue < MIN_AMOUNT) {
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

function normaliseDataTrades(rawTrades: DataTrade[]): NormalisedTrade[] {
  return rawTrades
    .map((raw) => {
      const priceValue = Number(raw.price ?? 0);
      const sizeValue = Number(raw.size ?? 0);
      const amountValue = Math.round(priceValue * sizeValue);

      if (!Number.isFinite(amountValue) || amountValue < MIN_AMOUNT) {
        return null;
      }

      const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : null;
      const createdAt = timestamp ? new Date(timestamp * 1000).toISOString() : null;

      const marketQuestion =
        (typeof raw.title === "string" && raw.title.length > 0
          ? raw.title
          : typeof raw.asset === "string" && raw.asset.length > 0
          ? raw.asset
          : null) ?? "Unknown market";

      const slugValue =
        typeof raw.slug === "string" && raw.slug.length > 0
          ? raw.slug
          : typeof raw.eventSlug === "string" && raw.eventSlug.length > 0
          ? raw.eventSlug
          : null;

      const marketId =
        (typeof raw.conditionId === "string" && raw.conditionId.length > 0
          ? raw.conditionId
          : typeof raw.asset === "string" && raw.asset.length > 0
          ? raw.asset
          : typeof slugValue === "string"
          ? slugValue
          : null) ?? "unknown-market";

      const idValue =
        typeof raw.transactionHash === "string" && raw.transactionHash.length > 0
          ? raw.transactionHash
          : `${marketId}-${createdAt ?? Date.now()}`;

      const outcomeValue =
        typeof raw.outcome === "string" && raw.outcome.length > 0 ? raw.outcome : "Unknown";

      return {
        id: idValue,
        marketId,
        marketQuestion,
        outcome: outcomeValue,
        amount: amountValue,
        marketSlug: slugValue,
        createdAt,
      } satisfies NormalisedTrade;
    })
    .filter((trade): trade is NormalisedTrade => trade !== null);
}

async function fetchGammaTrades(limit: number): Promise<NormalisedTrade[]> {
  const url = new URL("https://gamma-api.polymarket.com/trades");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Gamma API ${response.status}`);
  }

  const json = (await response.json()) as { trades?: GammaTrade[] } | GammaTrade[] | undefined;
  const tradesArray = Array.isArray(json)
    ? json
    : Array.isArray(json?.trades)
    ? json.trades
    : [];

  if (tradesArray.length === 0) {
    return [];
  }

  return normaliseGammaTrades(tradesArray);
}

async function fetchDataFallback(limit: number): Promise<NormalisedTrade[]> {
  const url = new URL("https://data-api.polymarket.com/trades");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("takerOnly", "true");
  url.searchParams.set("filterType", "CASH");

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Data API ${response.status}${text ? ` – ${text}` : ""}`);
  }

  const json = (await response.json()) as DataTrade[] | undefined;
  const tradesArray = Array.isArray(json) ? json : [];

  if (tradesArray.length === 0) {
    return [];
  }

  return normaliseDataTrades(tradesArray);
}

export async function GET() {
  try {
    let trades: NormalisedTrade[] = [];
    let lastError: Error | null = null;

    try {
      trades = await fetchGammaTrades(200);
    } catch (gammaError) {
      lastError = gammaError instanceof Error ? gammaError : new Error(String(gammaError));
      console.error("Polymarket trades gamma error:", lastError.message);
    }

    if (trades.length === 0) {
      try {
        trades = await fetchDataFallback(200);
      } catch (fallbackError) {
        const error =
          fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
        console.error("Polymarket trades fallback error:", error.message);
        throw lastError ?? error;
      }
    }

    return NextResponse.json(trades);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Polymarket trades error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
