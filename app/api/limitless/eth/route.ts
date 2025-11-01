import { NextResponse } from "next/server";

const MARKET_SLUG = "eth-price-prediction";
const LIMITLESS_BASE_URL = "https://api.limitless.exchange/markets";

interface FeedEventLike {
  timestamp?: number | string | null;
  price?: number | string | null;
  data?: {
    price?: number | string | null;
  } | null;
}

interface FeedEnvelope {
  events?: FeedEventLike[] | null;
}

interface MarketEnvelope {
  strike_price?: number | string | null;
  end_time?: number | string | null;
  market?: {
    strike_price?: number | string | null;
    end_time?: number | string | null;
  } | null;
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

function extractEvents(payload: unknown): FeedEventLike[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload as FeedEventLike[];
  }

  if (typeof payload === "object" && payload !== null) {
    const events = (payload as FeedEnvelope).events;
    if (Array.isArray(events)) {
      return events;
    }
  }

  return [];
}

function extractStrike(meta: MarketEnvelope | null | undefined): number | null {
  if (!meta) {
    return null;
  }

  const direct = toNumber(meta.strike_price);
  if (direct !== null) {
    return direct;
  }

  if (meta.market) {
    const nested = toNumber(meta.market.strike_price);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

function extractClosesAt(meta: MarketEnvelope | null | undefined): number | null {
  if (!meta) {
    return null;
  }

  const direct = normaliseTimestamp(meta.end_time);
  if (direct !== null) {
    return direct;
  }

  if (meta.market) {
    const nested = normaliseTimestamp(meta.market.end_time);
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

export async function GET() {
  try {
    const [metaResponse, feedResponse] = await Promise.all([
      fetch(`${LIMITLESS_BASE_URL}/${MARKET_SLUG}`),
      fetch(`${LIMITLESS_BASE_URL}/${MARKET_SLUG}/get-feed-events?limit=50`),
    ]);

    if (!metaResponse.ok) {
      throw new Error(`Limitless meta error ${metaResponse.status}`);
    }

    if (!feedResponse.ok) {
      throw new Error(`Limitless feed error ${feedResponse.status}`);
    }

    const metaJson = (await metaResponse.json()) as MarketEnvelope;
    const feedJson = await feedResponse.json();

    const events = extractEvents(feedJson);

    const prices: NormalisedPricePoint[] = events
      .map((event) => {
        const timestamp = normaliseTimestamp(event.timestamp);
        const priceCandidate = event.price ?? event.data?.price ?? null;
        const price = toNumber(priceCandidate);
        if (timestamp === null || price === null) {
          return null;
        }

        return { timestamp, price } satisfies NormalisedPricePoint;
      })
      .filter((point): point is NormalisedPricePoint => point !== null)
      .slice(-200);

    const strike = extractStrike(metaJson);
    const closesAt = extractClosesAt(metaJson);

    return NextResponse.json({
      strike,
      closesAt,
      prices,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("ETH feed error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
