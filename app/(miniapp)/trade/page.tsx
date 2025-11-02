import TradeClient from "./TradeClient";
import type { MarketSnapshot, PositionSnapshot, PricePoint } from "./types";

export const dynamic = "force-dynamic";

const LIMITLESS_BASE_URL = "https://api.limitless.exchange/markets";
const DEFAULT_MARKET_SLUG = "bitcoin-price-prediction";
const FETCH_TIMEOUT_MS = 8_000;

const FALLBACK_POSITION: PositionSnapshot = {
  direction: "up",
  statement: "Bitcoin will go Up",
  pnlPercent: -99.8,
  investment: 1.3,
  currentValue: 0.0021,
  payout: 2.19,
};

const FALLBACK_HISTORY: PricePoint[] = [
  { timestamp: Date.now() - 55 * 60 * 1000, price: 110_842.56 },
  { timestamp: Date.now() - 50 * 60 * 1000, price: 110_764.11 },
  { timestamp: Date.now() - 45 * 60 * 1000, price: 110_712.48 },
  { timestamp: Date.now() - 40 * 60 * 1000, price: 110_695.22 },
  { timestamp: Date.now() - 35 * 60 * 1000, price: 110_654.77 },
  { timestamp: Date.now() - 30 * 60 * 1000, price: 110_603.18 },
  { timestamp: Date.now() - 25 * 60 * 1000, price: 110_544.36 },
  { timestamp: Date.now() - 20 * 60 * 1000, price: 110_491.07 },
  { timestamp: Date.now() - 15 * 60 * 1000, price: 110_438.64 },
  { timestamp: Date.now() - 10 * 60 * 1000, price: 110_412.33 },
  { timestamp: Date.now() - 5 * 60 * 1000, price: 110_398.51 },
  { timestamp: Date.now() - 60 * 1000, price: 110_392.28 },
];

function buildFallbackSnapshot(slug: string): MarketSnapshot {
  const history = FALLBACK_HISTORY.map((point, index) => ({
    timestamp: point.timestamp + index,
    price: point.price,
  }));

  const currentPrice = history.at(-1)?.price ?? 110_392.28;

  return {
    slug,
    title: "Bitcoin Baseline Challenge",
    baseline: 110_678.99,
    strike: 110_678.99,
    priceHistory: history,
    currentPrice,
    expirationTimestamp: Date.now() + 2 * 60 * 1000 + 15 * 1000,
    aboveMultiplier: 500,
    belowMultiplier: 1,
    source: "mock",
    fallback: true,
    lastUpdated: Date.now(),
    position: FALLBACK_POSITION,
  } satisfies MarketSnapshot;
}

type NumericLike = number | string | null | undefined;

type LimitlessOrderLevel = { price?: NumericLike };

type LimitlessOrderbook = {
  asks?: LimitlessOrderLevel[];
  bids?: LimitlessOrderLevel[];
  buy?: LimitlessOrderLevel[];
  sell?: LimitlessOrderLevel[];
  above?: LimitlessOrderLevel[];
  below?: LimitlessOrderLevel[];
};

type MarketPayload = {
  question?: string | null;
  title?: string | null;
  strikePrice?: NumericLike;
  strike_price?: NumericLike;
  baseline?: NumericLike;
  baseline_price?: NumericLike;
  last_trade_price?: NumericLike;
  mark_price?: NumericLike;
  midpoint_price?: NumericLike;
  lastPrice?: NumericLike;
  end_time?: NumericLike;
  expiration?: NumericLike;
  expiration_timestamp?: NumericLike;
  expires_at?: NumericLike;
  metadata?: {
    strikePrice?: NumericLike;
    strike_price?: NumericLike;
    baseline?: NumericLike;
    baseline_price?: NumericLike;
  } | null;
  multipliers?: Record<string, NumericLike> | null;
  payouts?: Record<string, NumericLike> | null;
  orderbook?: LimitlessOrderbook | null;
  orderbooks?: LimitlessOrderbook | null;
};

type MarketResponse = {
  slug?: string;
  question?: string | null;
  title?: string | null;
  description?: string | null;
  strikePrice?: NumericLike;
  strike_price?: NumericLike;
  baseline?: NumericLike;
  baseline_price?: NumericLike;
  last_trade_price?: NumericLike;
  lastPrice?: NumericLike;
  mark_price?: NumericLike;
  midpoint_price?: NumericLike;
  last_price?: NumericLike;
  expirationTimestamp?: NumericLike;
  expiration_timestamp?: NumericLike;
  end_time?: NumericLike;
  market?: MarketPayload | null;
  multipliers?: Record<string, NumericLike> | null;
  payouts?: Record<string, NumericLike> | null;
  orderbook?: LimitlessOrderbook | null;
  orderbooks?: LimitlessOrderbook | null;
};

type FeedEvent = {
  timestamp?: NumericLike;
  price?: NumericLike;
  close?: NumericLike;
  data?: {
    price?: NumericLike;
    lastTradePrice?: NumericLike;
    markPrice?: NumericLike;
  } | null;
};

type HistoryPayload = {
  prices?: unknown;
  events?: FeedEvent[] | null;
};

function toNumber(value: NumericLike): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toTimestamp(value: NumericLike): number | null {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return Number.isFinite(milliseconds) ? Math.trunc(milliseconds) : null;
}

function firstOrderPrice(levels?: LimitlessOrderLevel[] | null): number | null {
  if (!levels) {
    return null;
  }

  for (const level of levels) {
    const candidate = toNumber(level?.price);
    if (candidate !== null) {
      return candidate;
    }
  }

  return null;
}

function extractMultiplier(source: MarketResponse, side: "above" | "below"): number | null {
  const multipliers =
    toNumber(source.multipliers?.[side]) ?? toNumber(source.market?.multipliers?.[side]);
  if (multipliers !== null) {
    return multipliers;
  }

  const payouts = toNumber(source.payouts?.[side]) ?? toNumber(source.market?.payouts?.[side]);
  if (payouts !== null) {
    return payouts;
  }

  const orderbookSources: Array<LimitlessOrderbook | null | undefined> = [
    source.orderbook,
    source.orderbooks,
    source.market?.orderbook,
    source.market?.orderbooks,
  ];

  for (const entry of orderbookSources) {
    if (!entry) continue;
    const level =
      side === "above"
        ? firstOrderPrice(entry.asks ?? entry.sell ?? entry.above)
        : firstOrderPrice(entry.bids ?? entry.buy ?? entry.below);
    if (level !== null && level > 0) {
      const multiplier = level > 10 ? level : Number((1 / level).toFixed(2));
      return Number.isFinite(multiplier) ? multiplier : null;
    }
  }

  return null;
}

function extractBaseline(source: MarketResponse): number | null {
  const direct =
    toNumber(source.strikePrice) ??
    toNumber(source.strike_price) ??
    toNumber(source.baseline) ??
    toNumber(source.baseline_price);
  if (direct !== null) {
    return direct;
  }

  const nested = source.market;
  if (nested) {
    const nestedBaseline =
      toNumber(nested.strikePrice) ??
      toNumber(nested.strike_price) ??
      toNumber(nested.baseline) ??
      toNumber(nested.baseline_price) ??
      toNumber(nested.metadata?.strikePrice) ??
      toNumber(nested.metadata?.strike_price) ??
      toNumber(nested.metadata?.baseline) ??
      toNumber(nested.metadata?.baseline_price);

    if (nestedBaseline !== null) {
      return nestedBaseline;
    }
  }

  if (typeof source.description === "string") {
    const match = source.description.match(/\$(\d+(?:\.\d+)?)/);
    if (match) {
      const candidate = toNumber(match[1]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }

  return null;
}

function extractExpiration(source: MarketResponse): number | null {
  const direct =
    toTimestamp(source.expirationTimestamp) ??
    toTimestamp(source.expiration_timestamp) ??
    toTimestamp(source.end_time);
  if (direct !== null) {
    return direct;
  }

  const nested = source.market;
  if (!nested) {
    return null;
  }

  return (
    toTimestamp(nested.end_time) ??
    toTimestamp(nested.expiration) ??
    toTimestamp(nested.expiration_timestamp) ??
    toTimestamp(nested.expires_at)
  );
}

function extractCurrentPrice(source: MarketResponse, history: PricePoint[]): number | null {
  const direct =
    toNumber(source.last_trade_price) ??
    toNumber(source.lastPrice) ??
    toNumber(source.last_price) ??
    toNumber(source.market?.last_trade_price) ??
    toNumber(source.market?.mark_price) ??
    toNumber(source.market?.midpoint_price);

  if (direct !== null) {
    return direct;
  }

  return history.at(-1)?.price ?? null;
}

function normaliseHistory(payload: unknown): PricePoint[] {
  if (!payload) {
    return [];
  }

  const points: PricePoint[] = [];

  const pushPoint = (timestamp: number | null, price: number | null) => {
    if (timestamp === null || price === null) {
      return;
    }

    points.push({ timestamp, price });
  };

  const normaliseEntry = (entry: unknown) => {
    if (Array.isArray(entry)) {
      const [rawTs, rawPrice] = entry;
      pushPoint(toTimestamp(rawTs), toNumber(rawPrice));
      return;
    }

    if (typeof entry === "object" && entry !== null) {
      const record = entry as FeedEvent;
      pushPoint(toTimestamp(record.timestamp), toNumber(record.price) ?? toNumber(record.close));
    }
  };

  if (Array.isArray(payload)) {
    payload.forEach(normaliseEntry);
    return points.sort((a, b) => a.timestamp - b.timestamp).slice(-200);
  }

  if (typeof payload === "object") {
    const record = payload as HistoryPayload;
    if (Array.isArray(record.prices)) {
      record.prices.forEach(normaliseEntry);
    } else if (Array.isArray(record.events)) {
      record.events.forEach((event) => {
        if (!event) return;
        const timestamp = toTimestamp(event.timestamp);
        const price =
          toNumber(event.price) ??
          toNumber(event.close) ??
          toNumber(event.data?.price) ??
          toNumber(event.data?.lastTradePrice) ??
          toNumber(event.data?.markPrice);
        pushPoint(timestamp, price);
      });
    }
  }

  return points.sort((a, b) => a.timestamp - b.timestamp).slice(-200);
}

async function fetchWithTimeout<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      next: { revalidate: 0 },
    });

    const text = await response.text();

    if (!response.ok) {
      const reason = text || response.statusText || "Unknown error";
      throw new Error(`Limitless ${response.status}: ${reason}`);
    }

    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMarketSnapshot(slug: string): Promise<MarketSnapshot> {
  try {
    const [marketJson, historyJson] = await Promise.all([
      fetchWithTimeout<MarketResponse>(`${LIMITLESS_BASE_URL}/${encodeURIComponent(slug)}`),
      fetchWithTimeout<unknown>(
        `${LIMITLESS_BASE_URL}/${encodeURIComponent(slug)}/historical-price?interval=1h`,
      ),
    ]);

    const priceHistory = normaliseHistory(historyJson);
    const baseline = extractBaseline(marketJson) ?? priceHistory.at(-1)?.price ?? FALLBACK_HISTORY.at(-1)?.price ?? 0;
    const strike = baseline;
    const currentPrice =
      extractCurrentPrice(marketJson, priceHistory) ?? priceHistory.at(-1)?.price ?? baseline;
    const expiration = extractExpiration(marketJson);
    const aboveMultiplier = extractMultiplier(marketJson, "above") ?? 500;
    const belowMultiplier = extractMultiplier(marketJson, "below") ?? 1;

    const ensuredHistory = priceHistory.length
      ? priceHistory
      : FALLBACK_HISTORY.map((point) => ({
          timestamp: point.timestamp,
          price: point.price,
        }));

    const title =
      marketJson.question ??
      marketJson.title ??
      marketJson.market?.question ??
      marketJson.market?.title ??
      "Bitcoin Baseline Challenge";

    return {
      slug: marketJson.slug ?? slug,
      title,
      baseline,
      strike,
      priceHistory: ensuredHistory,
      currentPrice,
      expirationTimestamp: expiration,
      aboveMultiplier,
      belowMultiplier,
      source: "limitless",
      fallback: false,
      lastUpdated: Date.now(),
      position: FALLBACK_POSITION,
    } satisfies MarketSnapshot;
  } catch (error) {
    console.error("Limitless snapshot error", error);
    return buildFallbackSnapshot(slug);
  }
}

type TradePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TradePage({ searchParams }: TradePageProps) {
  const params = (await searchParams) ?? {};
  const slugParam = params.slug;
  const requestedSlug = Array.isArray(slugParam)
    ? slugParam[0]
    : typeof slugParam === "string"
      ? slugParam
      : undefined;
  const slug = requestedSlug && requestedSlug.trim().length > 0 ? requestedSlug.trim() : DEFAULT_MARKET_SLUG;
  const snapshot = await fetchMarketSnapshot(slug);

  return <TradeClient initialSnapshot={snapshot} slug={snapshot.slug} />;
}
