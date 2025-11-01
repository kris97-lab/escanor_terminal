import { NextResponse } from "next/server";

interface LimitlessFeedEvent {
  timestamp?: number | string | null;
  price?: number | string | null;
}

interface LimitlessMarketResponse {
  market?: {
    strike_price?: number | string | null;
    end_time?: number | string | null;
  };
}

interface NormalisedPricePoint {
  timestamp: number;
  price: number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normaliseTimestamp(raw: unknown): number | null {
  const numeric = toNumber(raw);
  if (numeric === null) {
    return null;
  }

  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return Number.isFinite(ms) ? Math.trunc(ms) : null;
}

export async function GET() {
  try {
    const feedResponse = await fetch(
      "https://api.limitless.exchange/markets/eth-usd-hourly-prediction/get-feed-events",
      { cache: "no-store" },
    );

    if (!feedResponse.ok) {
      throw new Error(`Limitless feed error ${feedResponse.status}`);
    }

    const feedJson = (await feedResponse.json()) as unknown;

    if (!Array.isArray(feedJson)) {
      throw new Error("Unexpected feed payload");
    }

    const normalisedPrices: NormalisedPricePoint[] = feedJson
      .map((entry: LimitlessFeedEvent) => {
        const timestamp = normaliseTimestamp(entry.timestamp);
        const price = toNumber(entry.price);
        if (timestamp === null || price === null) {
          return null;
        }
        return { timestamp, price } satisfies NormalisedPricePoint;
      })
      .filter((point): point is NormalisedPricePoint => point !== null)
      .slice(-50);

    const metaResponse = await fetch(
      "https://api.limitless.exchange/markets/eth-usd-hourly-prediction",
      { cache: "no-store" },
    );

    if (!metaResponse.ok) {
      throw new Error(`Limitless market error ${metaResponse.status}`);
    }

    const metaJson = (await metaResponse.json()) as LimitlessMarketResponse;

    const baseline = toNumber(metaJson.market?.strike_price) ?? 0;
    const closesAt = normaliseTimestamp(metaJson.market?.end_time);

    return NextResponse.json({
      baseline,
      closesAt,
      prices: normalisedPrices,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Limitless live fetch error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
