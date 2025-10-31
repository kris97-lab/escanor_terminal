import { NextResponse } from "next/server";

import fallbackSnapshot from "@/data/btc-fallback.json";
import {
  CoinGeckoClient,
  type CoinIdMarketChartResponse,
} from "@coingecko/coingecko-typescript";

type CoinGeckoPriceEntry = [number, number];

type NormalisedPricePoint = {
  timestamp: number;
  time: string;
  price: number;
};

type FallbackSnapshot = {
  prices?: NormalisedPricePoint[];
};

type ApiSource = "live" | "cache" | "fallback";

type CacheRecord = {
  prices: NormalisedPricePoint[];
  fetchedAt: number;
  source: Exclude<ApiSource, "cache">;
};

const CACHE_TTL_MS = 60_000;

const client = new CoinGeckoClient({
  apiKey: process.env.COINGECKO_API_KEY,
});

let cache: CacheRecord | null = null;

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

async function fetchLivePrices(): Promise<NormalisedPricePoint[]> {
  const response: CoinIdMarketChartResponse = await client.coinIdMarketChart({
    id: "bitcoin",
    vs_currency: "usd",
    days: 1,
    interval: "hourly",
  });

  return normaliseEntries(Array.isArray(response.prices) ? response.prices : undefined);
}

function buildCacheResponse(
  record: CacheRecord,
  sourceOverride?: ApiSource,
  errors?: string[],
) {
  return NextResponse.json(
    {
      prices: record.prices,
      source: sourceOverride ?? record.source,
      fetchedAt: record.fetchedAt,
      errors,
    },
    { status: 200 },
  );
}

export async function GET() {
  const now = Date.now();
  const errors: string[] = [];

  if (cache && cache.source === "live" && now - cache.fetchedAt < CACHE_TTL_MS) {
    return buildCacheResponse(cache, "cache");
  }

  try {
    const prices = await fetchLivePrices();

    if (prices.length > 0) {
      cache = {
        prices,
        fetchedAt: now,
        source: "live",
      } satisfies CacheRecord;

      return NextResponse.json(
        {
          prices,
          source: "live" as ApiSource,
          fetchedAt: now,
        },
        { status: 200 },
      );
    }

    errors.push("CoinGecko response missing price data");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown CoinGecko error";
    errors.push(message);
    console.error("BTC API error:", err);
  }

  if (cache) {
    const source = cache.source === "live" ? "cache" : "fallback";
    return buildCacheResponse(cache, source, errors);
  }

  const fallbackPrices = normaliseFallback(fallbackSnapshot as FallbackSnapshot);

  if (fallbackPrices.length > 0) {
    cache = {
      prices: fallbackPrices,
      fetchedAt: now,
      source: "fallback",
    } satisfies CacheRecord;

    return NextResponse.json(
      {
        prices: fallbackPrices,
        source: "fallback" as ApiSource,
        fetchedAt: now,
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
