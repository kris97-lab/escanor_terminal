"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectWallet } from "@coinbase/onchainkit/wallet";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MarketSnapshot, PositionSnapshot, PricePoint } from "./types";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const preciseCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const LIMITLESS_BASE_URL = "https://api.limitless.exchange/markets";
const WS_URL = "wss://ws.limitless.exchange/markets";
const POLL_INTERVAL = 3_000;
const MAX_POINTS = 200;

type ChartDatum = {
  time: string;
  price: number;
};

type FetchSnapshot = {
  priceHistory: PricePoint[];
  baseline: number | null;
  strike: number | null;
  currentPrice: number | null;
  expiration: number | null;
  aboveMultiplier: number | null;
  belowMultiplier: number | null;
  source: MarketSnapshot["source"];
};

type TradeClientProps = {
  initialSnapshot: MarketSnapshot;
  slug: string;
};

type NumericLike = number | string | null | undefined;

type LimitlessOrderLevel = {
  price?: NumericLike;
};

type LimitlessOrderbook = {
  asks?: LimitlessOrderLevel[];
  bids?: LimitlessOrderLevel[];
  buy?: LimitlessOrderLevel[];
  sell?: LimitlessOrderLevel[];
  above?: LimitlessOrderLevel[];
  below?: LimitlessOrderLevel[];
};

type MarketPayload = {
  strikePrice?: NumericLike;
  strike_price?: NumericLike;
  baseline?: NumericLike;
  baseline_price?: NumericLike;
  end_time?: NumericLike;
  expiration?: NumericLike;
  expiration_timestamp?: NumericLike;
  expires_at?: NumericLike;
  last_price?: NumericLike;
  lastPrice?: NumericLike;
  mark_price?: NumericLike;
  midpoint_price?: NumericLike;
  last_trade_price?: NumericLike;
  multipliers?: Record<string, NumericLike> | null;
  payouts?: Record<string, NumericLike> | null;
  orderbook?: LimitlessOrderbook | null;
  orderbooks?: LimitlessOrderbook | null;
  metadata?: {
    strikePrice?: NumericLike;
    strike_price?: NumericLike;
    baseline?: NumericLike;
    baseline_price?: NumericLike;
  } | null;
};

type MarketResponse = {
  strikePrice?: NumericLike;
  strike_price?: NumericLike;
  baseline?: NumericLike;
  baseline_price?: NumericLike;
  last_price?: NumericLike;
  lastPrice?: NumericLike;
  mark_price?: NumericLike;
  description?: string | null;
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
  data?: {
    price?: NumericLike;
    lastTradePrice?: NumericLike;
    markPrice?: NumericLike;
  } | null;
};

type WsMessage = {
  type?: string;
  product_id?: string;
  data?: {
    price?: NumericLike;
    markPrice?: NumericLike;
    lastTradePrice?: NumericLike;
    timestamp?: NumericLike;
  } | null;
  price?: NumericLike;
  timestamp?: NumericLike;
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

function toTimestamp(value: NumericLike): number | null {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return Number.isFinite(milliseconds) ? Math.trunc(milliseconds) : null;
}

function convertToMultiplier(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value > 10) {
    return value;
  }

  const inverted = 1 / value;
  return Number.isFinite(inverted) ? Number(inverted.toFixed(2)) : null;
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
    const multiplier = convertToMultiplier(level);
    if (multiplier !== null) {
      return multiplier;
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
    toNumber(source.market?.last_trade_price) ??
    toNumber(source.market?.mark_price) ??
    toNumber(source.market?.midpoint_price) ??
    toNumber(source.last_price) ??
    toNumber(source.lastPrice) ??
    toNumber(source.mark_price);

  if (direct !== null) {
    return direct;
  }

  const latest = history[history.length - 1];
  return latest ? latest.price : null;
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
      const [ts, price] = entry;
      pushPoint(toTimestamp(ts), toNumber(price));
      return;
    }

    if (typeof entry === "object" && entry !== null) {
      const record = entry as { timestamp?: NumericLike; price?: NumericLike; close?: NumericLike };
      pushPoint(toTimestamp(record.timestamp), toNumber(record.price) ?? toNumber(record.close));
    }
  };

  if (Array.isArray(payload)) {
    payload.forEach(normaliseEntry);
  } else if (typeof payload === "object") {
    const record = payload as { prices?: unknown; events?: unknown };
    if (Array.isArray(record.prices)) {
      record.prices.forEach(normaliseEntry);
    } else if (Array.isArray(record.events)) {
      (record.events as unknown[]).forEach((event) => {
        if (!event) return;
        const typedEvent = event as FeedEvent;
        const timestamp = toTimestamp(typedEvent.timestamp);
        const price =
          toNumber(typedEvent.price) ??
          toNumber(typedEvent.data?.price) ??
          toNumber(typedEvent.data?.lastTradePrice) ??
          toNumber(typedEvent.data?.markPrice);
        pushPoint(timestamp, price);
      });
    }
  }

  return points
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_POINTS);
}

function toChartData(points: PricePoint[]): ChartDatum[] {
  return points.map((point) => ({
    time: timeFormatter.format(new Date(point.timestamp)),
    price: point.price,
  }));
}

function formatCountdown(expiration: number | null): string {
  if (!expiration) {
    return "—";
  }

  const diff = Math.max(expiration - Date.now(), 0);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")} hrs ${minutes
      .toString()
      .padStart(2, "0")} mins`;
  }

  return `${minutes.toString().padStart(2, "0")} mins ${seconds
    .toString()
    .padStart(2, "0")} secs`;
}

function formatBaselineDelta(current: number, baseline: number): {
  direction: "up" | "down";
  text: string;
} {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return { direction: "up", text: "—" };
  }

  const delta = current - baseline;
  const direction = delta >= 0 ? "up" : "down";
  const absoluteDelta = Math.abs(delta);
  const percent = (absoluteDelta / baseline) * 100;
  const percentLabel = `${direction === "up" ? "+" : "-"}${percent.toFixed(2)}%`;
  const arrow = direction === "up" ? "↑" : "↓";

  return {
    direction,
    text: `${arrow} ${currencyFormatter.format(absoluteDelta)} (${percentLabel})`,
  };
}

function WalletBadge() {
  return (
    <ConnectWallet
      render={({ onClick, status, isLoading }) => (
        <button
          type="button"
          onClick={onClick}
          className="flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-white transition hover:border-white/25"
          disabled={isLoading}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-sm text-white">👛</span>
          <span>{status === "connected" ? "0.24 USD" : "Connect"}</span>
        </button>
      )}
    />
  );
}

function PositionCard({ position }: { position: PositionSnapshot }) {
  const arrow = position.direction === "up" ? "↑" : "↓";
  const arrowColor = position.direction === "up" ? "text-emerald-300" : "text-red-400";
  const pnlColor = position.pnlPercent >= 0 ? "text-emerald-300" : "text-red-400";

  return (
    <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(255,243,90,0.12),transparent_55%),rgba(6,6,6,0.92)] p-6 text-left shadow-[0_28px_60px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight text-white">
          <span className={`mr-2 text-2xl ${arrowColor}`}>{arrow}</span>
          {position.statement}
        </span>
        <span className={`text-sm font-semibold ${pnlColor}`}>
          {position.pnlPercent > 0 ? "+" : ""}
          {position.pnlPercent.toFixed(1)}%
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.28em] text-white/45">Investment</div>
          <div className="font-mono text-white">{currencyFormatter.format(position.investment)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.28em] text-white/45">Current value</div>
          <div className="font-mono text-white">{preciseCurrencyFormatter.format(position.currentValue)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.28em] text-white/45">If you&apos;re right</div>
          <div className="font-mono text-emerald-300">
            {currencyFormatter.format(position.payout)}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.28em] text-white/45">Direction</div>
          <div className="font-mono text-white uppercase">{position.direction}</div>
        </div>
      </div>
    </div>
  );
}

export default function TradeClient({ initialSnapshot, slug }: TradeClientProps) {
  const [pricePoints, setPricePoints] = useState<PricePoint[]>(() => initialSnapshot.priceHistory);
  const [currentPrice, setCurrentPrice] = useState(initialSnapshot.currentPrice);
  const [previousPrice, setPreviousPrice] = useState(
    initialSnapshot.priceHistory[initialSnapshot.priceHistory.length - 2]?.price ??
      initialSnapshot.currentPrice,
  );
  const [baseline, setBaseline] = useState(initialSnapshot.baseline);
  const [strike, setStrike] = useState(initialSnapshot.strike);
  const [expiration, setExpiration] = useState(initialSnapshot.expirationTimestamp);
  const [aboveMultiplier, setAboveMultiplier] = useState(initialSnapshot.aboveMultiplier);
  const [belowMultiplier, setBelowMultiplier] = useState(initialSnapshot.belowMultiplier);
  const [source, setSource] = useState(initialSnapshot.source);
  const [countdown, setCountdown] = useState(() => formatCountdown(initialSnapshot.expirationTimestamp));
  const [selectedSide, setSelectedSide] = useState<"above" | "below">("above");
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error" | "offline">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!expiration) {
      setCountdown("—");
      return;
    }

    const updateCountdown = () => {
      setCountdown(formatCountdown(expiration));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(interval);
  }, [expiration]);

  const chartData = useMemo<ChartDatum[]>(() => toChartData(pricePoints), [pricePoints]);

  const baselineTrend = useMemo(
    () => formatBaselineDelta(currentPrice, baseline ?? currentPrice),
    [baseline, currentPrice],
  );
  const isAboveBaseline = baselineTrend.direction === "up";

  const safeBaseline = Number.isFinite(baseline) ? baseline : initialSnapshot.baseline;
  const safeStrike = Number.isFinite(strike) ? strike : safeBaseline;
  const safeAbove = Number.isFinite(aboveMultiplier)
    ? aboveMultiplier
    : initialSnapshot.aboveMultiplier;
  const safeBelow = Number.isFinite(belowMultiplier)
    ? belowMultiplier
    : initialSnapshot.belowMultiplier;

  const formatMultiplierValue = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      return "1.00";
    }
    if (value >= 1000) {
      return value.toFixed(0);
    }
    if (value >= 100) {
      return value.toFixed(1);
    }
    if (value >= 10) {
      return value.toFixed(1);
    }
    return value.toFixed(2);
  };

  const aboveLabel = `x${formatMultiplierValue(safeAbove)}`;
  const belowLabel = `x${formatMultiplierValue(safeBelow)}`;
  const marketLabel = initialSnapshot.title ?? "BTC · USD";

  const connectionClass =
    connectionStatus === "connected"
      ? "border-emerald-400/60 text-emerald-300"
      : connectionStatus === "error"
        ? "border-red-400/60 text-red-400"
        : connectionStatus === "offline"
          ? "border-yellow-300/40 text-yellow-200"
          : "border-yellow-300/40 text-yellow-200";

  const connectionText =
    connectionStatus === "connected"
      ? "Live feed"
      : connectionStatus === "error"
        ? "Reconnecting"
        : connectionStatus === "offline"
          ? "Offline"
          : "Connecting";

  const updatePricePoints = useCallback(
    (timestamp: number, price: number | null) => {
      if (price === null || !Number.isFinite(price)) {
        return;
      }

      setPricePoints((prev) => {
        const trimmed = prev.length >= MAX_POINTS ? prev.slice(prev.length - (MAX_POINTS - 1)) : prev;
        const nextPoints = [...trimmed, { timestamp, price }];
        const priorPrice = trimmed.length > 0 ? trimmed[trimmed.length - 1].price : price;
        setPreviousPrice(priorPrice);
        return nextPoints;
      });
      setCurrentPrice(price);
      lastFetchRef.current = timestamp;
    },
    [],
  );

  const normaliseResponse = useCallback(
    (market: MarketResponse, historyPayload: unknown): FetchSnapshot => {
      const priceHistory = normaliseHistory(historyPayload);
      const baselineValue = extractBaseline(market);
      const strikeValue = baselineValue ?? null;
      const expirationValue = extractExpiration(market);
      const currentFromMarket = extractCurrentPrice(market, priceHistory);
      const above = extractMultiplier(market, "above");
      const below = extractMultiplier(market, "below");

      return {
        priceHistory,
        baseline: baselineValue,
        strike: strikeValue ?? baselineValue,
        currentPrice: currentFromMarket,
        expiration: expirationValue,
        aboveMultiplier: above,
        belowMultiplier: below,
        source: "limitless",
      } satisfies FetchSnapshot;
    },
    [],
  );

  const fetchLatest = useCallback(async () => {
    try {
      const [marketRes, historyRes] = await Promise.all([
        fetch(`${LIMITLESS_BASE_URL}/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        fetch(`${LIMITLESS_BASE_URL}/${encodeURIComponent(slug)}/historical-price?interval=1h`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
      ]);

      if (!marketRes.ok || !historyRes.ok) {
        throw new Error(`HTTP ${marketRes.status}/${historyRes.status}`);
      }

      const marketJson = (await marketRes.json()) as MarketResponse;
      const historyJson = await historyRes.json();

      const snapshot = normaliseResponse(marketJson, historyJson);
      if (snapshot.priceHistory.length > 0) {
        setPricePoints(snapshot.priceHistory);
        setCurrentPrice(
          snapshot.currentPrice ?? snapshot.priceHistory[snapshot.priceHistory.length - 1]?.price ?? currentPrice,
        );
        setPreviousPrice(
          snapshot.priceHistory[snapshot.priceHistory.length - 2]?.price ??
            snapshot.priceHistory[snapshot.priceHistory.length - 1]?.price ??
            previousPrice,
        );
        lastFetchRef.current = snapshot.priceHistory[snapshot.priceHistory.length - 1]?.timestamp ?? Date.now();
      }

      if (snapshot.baseline !== null) {
        setBaseline(snapshot.baseline);
      }
      if (snapshot.strike !== null) {
        setStrike(snapshot.strike);
      }
      if (snapshot.expiration) {
        setExpiration(snapshot.expiration);
      }
      if (snapshot.aboveMultiplier !== null) {
        setAboveMultiplier(snapshot.aboveMultiplier);
      }
      if (snapshot.belowMultiplier !== null) {
        setBelowMultiplier(snapshot.belowMultiplier);
      }

      setSource(snapshot.source);
      setError(null);
    } catch (err) {
      console.error("Limitless poll error:", err);
      if (!initialSnapshot.fallback) {
        setError((err as Error).message ?? "Failed to refresh market");
      }
    }
  }, [currentPrice, initialSnapshot.fallback, normaliseResponse, previousPrice, slug]);

  useEffect(() => {
    const interval = window.setInterval(fetchLatest, POLL_INTERVAL);
    fetchLatest();
    return () => window.clearInterval(interval);
  }, [fetchLatest]);

  useEffect(() => {
    let isActive = true;

    const connect = () => {
      if (!isActive) {
        return;
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("connected");
        ws.send(
          JSON.stringify({
            type: "subscribe",
            channels: [
              {
                name: "market_updates",
                product_ids: [slug],
              },
            ],
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as WsMessage;
          if (payload && payload.data) {
            const nextPrice =
              toNumber(payload.data.price) ??
              toNumber(payload.data.lastTradePrice) ??
              toNumber(payload.data.markPrice);
            const timestamp = toTimestamp(payload.data.timestamp) ?? Date.now();
            if (nextPrice !== null) {
              updatePricePoints(timestamp, nextPrice);
              setSource("limitless");
            }
          } else if (payload && payload.price !== undefined) {
            const nextPrice = toNumber(payload.price);
            const timestamp = toTimestamp(payload.timestamp) ?? Date.now();
            if (nextPrice !== null) {
              updatePricePoints(timestamp, nextPrice);
              setSource("limitless");
            }
          }
        } catch (parseError) {
          console.warn("WS parse error", parseError);
        }
      };

      ws.onerror = (event) => {
        console.error("WebSocket error", event);
        setConnectionStatus("error");
      };

      ws.onclose = () => {
        if (!isActive) {
          return;
        }
        setConnectionStatus("offline");
        reconnectTimer.current = setTimeout(() => {
          setConnectionStatus("connecting");
          connect();
        }, 2_000);
      };
    };

    connect();

    return () => {
      isActive = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [slug, updatePricePoints]);

  return (
    <div className="flex min-h-[calc(100vh-5rem)] w-full justify-center bg-black px-4 py-6 text-white">
      <div className="w-full max-w-xl space-y-6 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(255,243,90,0.12),transparent_55%),_rgba(10,10,10,0.95)] p-6 shadow-[0_25px_60px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/45">Baseline price</span>
            <span className="font-mono text-2xl font-semibold text-white">
              {currencyFormatter.format(safeBaseline)}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[0.6rem] uppercase tracking-[0.3em] text-white/45">Closes in</span>
            <span className="font-mono text-sm text-white">{countdown}</span>
            <span className="block text-[0.6rem] uppercase tracking-[0.3em] text-white/30">CLOSES IN</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <WalletBadge />
            <button
              type="button"
              className="rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white shadow-[0_0_35px_rgba(59,130,246,0.35)] transition hover:bg-blue-400"
            >
              Deposit
            </button>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.28em] ${connectionClass}`}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            <span>{connectionText}</span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.35em] text-white/45">{marketLabel}</span>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="font-mono text-4xl font-semibold tracking-tight text-white">
                  {currencyFormatter.format(currentPrice)}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                    isAboveBaseline ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {baselineTrend.text}
                </span>
              </div>
            </div>
            <div className="text-right text-xs uppercase tracking-[0.3em] text-white/50">
              <span className="block">Updated</span>
              <span className="font-mono text-white/70">
                {timeFormatter.format(new Date(lastFetchRef.current))}
              </span>
              <span className="mt-1 block text-[0.6rem] text-white/35">
                {source === "limitless" ? "Limitless live feed" : "Snapshot fallback"}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/60 p-4 shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]">
            {error ? (
              <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">
                Failed to refresh market: {error}
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis dataKey="time" stroke="#888" tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="#888"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => compactCurrencyFormatter.format(value)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#090909",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 16,
                        color: "#fff",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [currencyFormatter.format(value), "Price"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#FF4D67"
                      strokeWidth={2.6}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {Number.isFinite(safeStrike) && (
                      <ReferenceLine
                        y={safeStrike}
                        stroke="#FF8A80"
                        strokeDasharray="6 6"
                        label={{ value: "BASELINE", position: "right", fill: "#FF8A80", fontSize: 11 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setSelectedSide("above")}
              className={`flex flex-1 items-center justify-between rounded-2xl border px-5 py-3 text-left text-sm font-semibold uppercase tracking-[0.28em] transition ${
                selectedSide === "above"
                  ? "border-white bg-white text-black shadow-[0_18px_40px_rgba(255,255,255,0.2)]"
                  : "border-white/12 bg-white/5 text-white/80 hover:border-white/20"
              }`}
            >
              <span>Above ↑</span>
              <span className="font-mono text-base">{aboveLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedSide("below")}
              className={`flex flex-1 items-center justify-between rounded-2xl border px-5 py-3 text-left text-sm font-semibold uppercase tracking-[0.28em] transition ${
                selectedSide === "below"
                  ? "border-white bg-white text-black shadow-[0_18px_40px_rgba(255,255,255,0.2)]"
                  : "border-white/12 bg-white/5 text-white/80 hover:border-white/20"
              }`}
            >
              <span>Below ↓</span>
              <span className="font-mono text-base">{belowLabel}</span>
            </button>
          </div>
        </div>

        <PositionCard position={initialSnapshot.position} />

        <p className="text-center text-[0.6rem] uppercase tracking-[0.3em] text-white/45">
          Auto-refreshing every 3 seconds · Source: {source === "limitless" ? "Limitless API" : "Mock snapshot"}
        </p>
      </div>
    </div>
  );
}
