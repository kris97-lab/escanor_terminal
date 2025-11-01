import { NextResponse } from "next/server";

const MARKET_SLUG = "dollareth-above-dollar387149-on-nov-1-1600-utc-1762009208957";
const LIMITLESS_BASE_URL = "https://api.limitless.exchange/markets";
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1&interval=minute";

type NumericLike = number | string | null | undefined;

type FeedEvent = {
  timestamp?: NumericLike;
  price?: NumericLike;
  data?: {
    price?: NumericLike;
    lastTradePrice?: NumericLike;
  } | null;
};

type FeedPayload = {
  events?: FeedEvent[] | null;
};

type MarketPayload = {
  strikePrice?: NumericLike;
  strike_price?: NumericLike;
  description?: string | null;
  market?: {
    strike_price?: NumericLike;
    end_time?: NumericLike;
  } | null;
  end_time?: NumericLike;
};

type NormalisedPoint = {
  timestamp: number;
  price: number;
};

type LimitlessResponse = {
  strike: number | null;
  closesAt: number | null;
  prices: NormalisedPoint[];
  source: "limitless" | "coingecko";
};

function toNumber(value: NumericLike): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normaliseTimestamp(raw: NumericLike): number | null {
  const numeric = toNumber(raw);
  if (numeric === null) {
    return null;
  }

  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return Number.isFinite(ms) ? Math.trunc(ms) : null;
}

function extractEvents(payload: unknown): FeedEvent[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload as FeedEvent[];
  }

  if (typeof payload === "object") {
    const events = (payload as FeedPayload).events;
    if (Array.isArray(events)) {
      return events;
    }
  }

  return [];
}

function extractStrike(meta: MarketPayload | null | undefined): number | null {
  if (!meta) {
    return null;
  }

  const direct = toNumber(meta.strikePrice) ?? toNumber(meta.strike_price);
  if (direct !== null) {
    return direct;
  }

  if (meta.market) {
    const nested = toNumber(meta.market.strike_price);
    if (nested !== null) {
      return nested;
    }
  }

  if (typeof meta.description === "string") {
    const match = meta.description.match(/\$(\d+(?:\.\d+)?)/);
    if (match) {
      const candidate = toNumber(match[1]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }

  return null;
}

function extractClosesAt(meta: MarketPayload | null | undefined): number | null {
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

function normaliseEvents(events: FeedEvent[]): NormalisedPoint[] {
  return events
    .map((event) => {
      const timestamp = normaliseTimestamp(event.timestamp);
      const priceCandidate =
        toNumber(event.price) ?? toNumber(event.data?.price) ?? toNumber(event.data?.lastTradePrice);

      if (timestamp === null || priceCandidate === null) {
        return null;
      }

      return { timestamp, price: priceCandidate } satisfies NormalisedPoint;
    })
    .filter((point): point is NormalisedPoint => point !== null)
    .slice(-200);
}

async function fetchLimitless(): Promise<LimitlessResponse> {
  const [marketRes, feedRes] = await Promise.all([
    fetch(`${LIMITLESS_BASE_URL}/${MARKET_SLUG}`),
    fetch(`${LIMITLESS_BASE_URL}/${MARKET_SLUG}/get-feed-events?limit=50`),
  ]);

  if (!marketRes.ok) {
    throw new Error(`Limitless market error ${marketRes.status}`);
  }

  if (!feedRes.ok) {
    throw new Error(`Limitless feed error ${feedRes.status}`);
  }

  const marketJson = (await marketRes.json()) as MarketPayload;
  const feedJson = await feedRes.json();

  const strike = extractStrike(marketJson);
  const closesAt = extractClosesAt(marketJson);
  const prices = normaliseEvents(extractEvents(feedJson));

  return { strike, closesAt, prices, source: "limitless" };
}

async function fetchCoinGeckoFallback(): Promise<LimitlessResponse> {
  const response = await fetch(COINGECKO_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CoinGecko error ${response.status}`);
  }

  const json = (await response.json()) as { prices?: Array<[number, number]> };
  const prices = (json.prices ?? [])
    .slice(-50)
    .map((entry) => ({
      timestamp: entry[0],
      price: entry[1],
    }))
    .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.timestamp));

  return { strike: null, closesAt: null, prices, source: "coingecko" };
}

export async function GET() {
  try {
    const payload = await fetchLimitless();
    return NextResponse.json(payload satisfies LimitlessResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Limitless error";
    console.error("Limitless API error:", message);

    try {
      const fallback = await fetchCoinGeckoFallback();
      return NextResponse.json(fallback satisfies LimitlessResponse);
    } catch (fallbackErr) {
      const fallbackMessage =
        fallbackErr instanceof Error ? fallbackErr.message : "Unknown CoinGecko error";
      console.error("CoinGecko fallback error:", fallbackMessage);
      return NextResponse.json(
        { error: `Limitless API error: ${message}. Fallback failed: ${fallbackMessage}` },
        { status: 500 },
      );
    }
  }
}
