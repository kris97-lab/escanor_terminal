"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

import { Button } from "@/components/ui/button";

import layoutStyles from "../layout.module.css";
import styles from "./page.module.css";

const WS_ENDPOINT = "wss://api.limitless.exchange/ws";
const MARKET_PRODUCT_ID = "dollareth-above-dollar387149-on-nov-1-1600-utc-1762009208957";
const MAX_POINTS = 200;
const POLL_INTERVAL = 3_000;

interface PricePoint {
  timestamp: number;
  price: number;
}

interface FeedSuccess {
  strike: number | null;
  closesAt: number | null;
  prices: PricePoint[];
  source: "limitless" | "coingecko";
}

interface FeedError {
  error: string;
}

type FeedResponse = FeedSuccess | FeedError;

type Status = "connecting" | "live" | "fallback" | "error";

function isFeedSuccess(payload: FeedResponse): payload is FeedSuccess {
  return (
    payload !== null &&
    typeof payload === "object" &&
    Array.isArray((payload as FeedSuccess).prices) &&
    typeof (payload as FeedSuccess).source === "string"
  );
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

function normalisePricePoint(point: unknown): PricePoint | null {
  if (!point || typeof point !== "object") {
    return null;
  }

  const candidate = point as Partial<PricePoint>;
  const timestamp = normaliseTimestamp(candidate.timestamp);
  const price = toNumber(candidate.price);

  if (timestamp === null || price === null) {
    return null;
  }

  return { timestamp, price } satisfies PricePoint;
}

function formatUsd(value: number | null, options?: Intl.NumberFormatOptions): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  })}`;
}

function formatStrike(value: number | null): string {
  if (value === null) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function useCountdown(target: number | null): string {
  const [label, setLabel] = useState<string>("—");

  useEffect(() => {
    if (!target) {
      setLabel("—");
      return;
    }

    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, target - now);
      const minutes = Math.floor(diff / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1000);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        const remainingMinutes = minutes % 60;
        setLabel(`${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`);
        return;
      }

      setLabel(`${minutes.toString().padStart(2, "0")}m ${seconds
        .toString()
        .padStart(2, "0")}s`);
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [target]);

  return label;
}

function parseWebSocketPayload(raw: unknown): {
  price: number | null;
  strike: number | null;
  timestamp: number | null;
} {
  let textPayload: string | null = null;

  if (typeof raw === "string") {
    textPayload = raw;
  } else if (raw instanceof ArrayBuffer) {
    textPayload = new TextDecoder().decode(raw);
  }

  if (textPayload === null) {
    return { price: null, strike: null, timestamp: null };
  }

  try {
    const payload = JSON.parse(textPayload) as Record<string, unknown>;

    const containers: Array<Record<string, unknown>> = [];

    if (payload.data && typeof payload.data === "object") {
      containers.push(payload.data as Record<string, unknown>);
    }

    const event = payload.event as Record<string, unknown> | undefined;
    if (event && typeof event.data === "object" && event.data !== null) {
      containers.push(event.data as Record<string, unknown>);
    }

    containers.push(payload);

    let price: number | null = null;
    let strike: number | null = null;
    let timestamp: number | null = null;

    for (const candidate of containers) {
      if (price === null && "price" in candidate) {
        price = toNumber(candidate.price);
      }
      if (strike === null && "strike_price" in candidate) {
        strike = toNumber(candidate.strike_price);
      }
      if (timestamp === null && "timestamp" in candidate) {
        timestamp = normaliseTimestamp(candidate.timestamp);
      }
    }

    if (timestamp === null) {
      timestamp = normaliseTimestamp(payload.timestamp);
    }

    return { price, strike, timestamp };
  } catch (err) {
    console.warn("WS parse error", err);
    return { price: null, strike: null, timestamp: null };
  }
}

export default function TradePage() {
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [closesAt, setClosesAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [feedSource, setFeedSource] = useState<"limitless" | "coingecko">("limitless");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const countdownLabel = useCountdown(closesAt);

  const appendPoint = useCallback((point: PricePoint) => {
    setSeries((previous) => {
      const next = [...previous, point];
      return next.slice(-MAX_POINTS);
    });
    setLastUpdated(Date.now());
  }, []);

  const fetchFeed = useCallback(
    async (phase: "initial" | "poll" = "poll") => {
      try {
        const response = await fetch("/api/limitless/eth", { cache: "no-store" });
        const json = (await response.json()) as FeedResponse;

        if (!response.ok || !isFeedSuccess(json)) {
          const message =
            !response.ok && !isFeedSuccess(json)
              ? `Limitless feed error ${response.status}`
              : (json as FeedError).error ?? "Unexpected feed error";
          throw new Error(message);
        }

        const normalisedSeries = json.prices
          .map((point) => normalisePricePoint(point))
          .filter((point): point is PricePoint => point !== null)
          .slice(-MAX_POINTS);

        setSeries(normalisedSeries);
        setFeedSource(json.source);
        setBaseline(typeof json.strike === "number" && Number.isFinite(json.strike) ? json.strike : null);
        setClosesAt(
          typeof json.closesAt === "number" && Number.isFinite(json.closesAt) ? json.closesAt : null,
        );
        setLastUpdated(Date.now());
        setError(null);

        const nextStatus =
          json.source === "coingecko"
            ? "fallback"
            : connected
            ? "live"
            : phase === "initial"
            ? "connecting"
            : "fallback";

        setStatus(nextStatus);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load feed";
        setError(message);
        setStatus("error");
      }
    },
    [connected],
  );

  const connectWebSocket = useCallback(() => {
    setStatus((prev) => (prev === "live" ? prev : "connecting"));
    try {
      const ws = new WebSocket(WS_ENDPOINT);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setStatus("live");
        setError(null);

        const subscription = {
          type: "subscribe",
          channels: [{ name: "market_updates", product_ids: [MARKET_PRODUCT_ID] }],
        };

        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        const { price, strike, timestamp } = parseWebSocketPayload(event.data);
        if (strike !== null) {
          setBaseline(strike);
        }

        if (price === null) {
          return;
        }

        const pointTimestamp = timestamp ?? Date.now();
        appendPoint({ timestamp: pointTimestamp, price });
        setStatus("live");
        setError(null);
      };

      ws.onerror = () => {
        setConnected(false);
        setStatus("fallback");
        if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setStatus("fallback");
        if (reconnectTimeoutRef.current === null) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket();
          }, 3_000);
        }
      };
    } catch (err) {
      console.error("WebSocket init error", err);
      setConnected(false);
      setStatus("fallback");
      if (reconnectTimeoutRef.current === null) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectWebSocket();
        }, 3_000);
      }
    }
  }, [appendPoint]);

  useEffect(() => {
    void fetchFeed("initial");
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connectWebSocket, fetchFeed]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchFeed();
    }, POLL_INTERVAL);

    return () => window.clearInterval(interval);
  }, [fetchFeed]);

  const chartData = useMemo(
    () =>
      series.map((point) => ({
        timestamp: point.timestamp,
        time: new Date(point.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        price: point.price,
      })),
    [series],
  );

  const currentPrice = series.length > 0 ? series[series.length - 1]!.price : null;
  const previousPrice = series.length > 1 ? series[series.length - 2]!.price : null;
  const priceDelta =
    currentPrice !== null && previousPrice !== null ? currentPrice - previousPrice : null;

  const deltaLabel = priceDelta !== null ? `${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(2)}` : "—";
  const deltaClass = priceDelta !== null && priceDelta < 0 ? styles.negative : styles.positive;

  const strikeValue = baseline ?? null;
  const isAboveStrike = strikeValue !== null && currentPrice !== null ? currentPrice >= strikeValue : false;
  const lastUpdatedLabel = formatTimestamp(lastUpdated);

  const statusLabel =
    status === "live"
      ? "Live · WebSocket"
      : status === "fallback"
      ? feedSource === "coingecko"
        ? "Fallback · CoinGecko"
        : "Fallback · REST"
      : status === "error"
      ? "Error"
      : "Connecting";

  const statusClass =
    status === "live"
      ? styles.statusLive
      : status === "error"
      ? styles.statusError
      : styles.statusLoading;

  return (
    <div className={layoutStyles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.priceBlock}>
            <span className={styles.badge}>ETH · Limitless WebSocket Feed</span>
            <div className={styles.priceRow}>
              <span className={styles.spot}>{formatUsd(currentPrice)}</span>
              <span className={`${styles.delta} ${deltaClass}`}>{deltaLabel}</span>
            </div>
            <div className={styles.metaRow}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Strike</span>
                <span className={styles.metaValue}>{formatStrike(strikeValue)}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Countdown</span>
                <span className={styles.metaValue}>{countdownLabel}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Updated</span>
                <span className={styles.metaValue}>{lastUpdatedLabel}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Source</span>
                <span
                  className={
                    feedSource === "coingecko" ? styles.metaValueWarning : styles.metaValue
                  }
                >
                  {feedSource === "coingecko" ? "CoinGecko fallback" : "Limitless"}
                </span>
              </div>
              <span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span>
            </div>
          </div>
        </header>

        <div className={styles.chartShell}>
          {status === "error" && error ? (
            <div className={styles.errorBanner}>Failed to refresh live market: {error}</div>
          ) : null}

          {chartData.length === 0 && status === "connecting" ? (
            <div className={styles.loading}>Loading ETH market data…</div>
          ) : null}

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.55)" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="rgba(255,255,255,0.45)"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(12,12,12,0.92)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "0.75rem",
                    color: "#f5f5f5",
                    fontFamily: "var(--font-source-code-pro), monospace",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: number | string) => {
                    const numeric = typeof value === "number" ? value : Number(value);
                    return [`$${numeric.toFixed(2)}`, "ETH Live"];
                  }}
                />
                {strikeValue !== null ? (
                  <ReferenceLine
                    y={strikeValue}
                    stroke="#ff4d4d"
                    strokeDasharray="6 4"
                    label={{ value: "Strike", position: "right", fill: "#ff4d4d", fontSize: 11 }}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#39ff14"
                  strokeWidth={2.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : null}
        </div>

        <div className={styles.actionsRow}>
          <Button
            variant="default"
            size="lg"
            block
            className={isAboveStrike ? styles.aboveActive : undefined}
          >
            Above {formatStrike(strikeValue)}
          </Button>
          <Button
            variant="outline"
            size="lg"
            block
            className={!isAboveStrike ? styles.belowActive : undefined}
          >
            Below {formatStrike(strikeValue)}
          </Button>
        </div>

        <p className={styles.footerNote}>
          Streaming via Limitless WebSocket · REST sync every {POLL_INTERVAL / 1000}s
        </p>
      </section>
    </div>
  );
}
