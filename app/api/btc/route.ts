import { NextResponse } from "next/server";

import fallbackSnapshot from "@/data/btc-fallback.json";

type CoinGeckoPriceEntry = [number, number];

type CoinGeckoResponse = {
  prices?: CoinGeckoPriceEntry[];
};

type NormalisedPricePoint = {
  timestamp: number;
  time: string;
  price: number;
};

type FallbackSnapshot = {
  prices?: NormalisedPricePoint[];
};

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly";

function normaliseEntries(entries: CoinGeckoPriceEntry[] | undefined): NormalisedPricePoint[] {
  if (!entries) {
    return [];
  }

  return entries
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }

      const [timestampRaw, priceRaw] = entry;
      const timestamp = Number(timestampRaw);
      const price = Number(priceRaw);

      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
        return null;
      }

      const adjustedTimestamp = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
      const date = new Date(adjustedTimestamp);

      return {
        timestamp: adjustedTimestamp,
        time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        price,
      } satisfies NormalisedPricePoint;
    })
    .filter((point): point is NormalisedPricePoint => point !== null);
}

function normaliseFallback(data: FallbackSnapshot): NormalisedPricePoint[] {
  if (!data || !Array.isArray(data.prices)) {
    return [];
  }

  return data.prices
    .map((point) => {
      if (!point) {
        return null;
      }

      const timestamp = Number(point.timestamp);
      const price = Number(point.price);
      const time = typeof point.time === "string" ? point.time : undefined;

      if (!Number.isFinite(timestamp) || !Number.isFinite(price) || !time) {
        return null;
      }

      return {
        timestamp,
        price,
        time,
      } satisfies NormalisedPricePoint;
    })
    .filter((point): point is NormalisedPricePoint => point !== null);
}

export async function GET() {
  const errors: string[] = [];

  try {
    const res = await fetch(COINGECKO_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "EscanorTerminal/1.0 (+https://farcaster.miniapp)",
      },
    });

    if (!res.ok) {
      errors.push(`CoinGecko returned ${res.status}`);
    } else {
      const data = (await res.json()) as CoinGeckoResponse;
      const prices = normaliseEntries(Array.isArray(data.prices) ? data.prices : undefined);

      if (prices.length > 0) {
        return NextResponse.json({ prices, source: "coingecko" as const }, { status: 200 });
      }

      errors.push("CoinGecko response missing price data");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    errors.push(message);
    console.error("BTC API error:", err);
  }

  const fallbackPrices = normaliseFallback(fallbackSnapshot as FallbackSnapshot);

  if (fallbackPrices.length > 0) {
    return NextResponse.json(
      {
        prices: fallbackPrices,
        source: "fallback" as const,
        warning: "Served cached BTC snapshot while CoinGecko was unavailable",
        errors,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      error: errors.at(-1) ?? "CoinGecko feed unavailable",
      errors,
    },
    { status: 502 },
  );
}
