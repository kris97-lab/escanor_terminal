"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import { Button } from "@/components/ui/button";

import layoutStyles from "../layout.module.css";
import styles from "./page.module.css";

type ApiPricePoint = {
  timestamp: number;
  time: string;
  price: number;
};

type ChartPoint = ApiPricePoint & {
  movingAverage: number;
};

type ApiSource = "coingecko" | "fallback";

type BtcApiResponse = {
  prices?: ApiPricePoint[];
  error?: string;
  source?: ApiSource;
  warning?: string;
  errors?: string[];
};

const MOVING_AVERAGE_WINDOW = 5;
const CACHE_KEY = "degen-terminal-btc-cache-v1";

type Status = "loading" | "connected" | "fallback" | "error";

function isPricePoint(value: unknown): value is ApiPricePoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.time === "string" &&
    typeof record.timestamp === "number" &&
    Number.isFinite(record.timestamp) &&
    typeof record.price === "number" &&
    Number.isFinite(record.price)
  );
}

function formatUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function loadCachedSnapshot(): { prices: ApiPricePoint[]; source: ApiSource; fetchedAt: number | null } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      prices?: ApiPricePoint[];
      source?: ApiSource;
      fetchedAt?: number;
    };

    const prices = Array.isArray(parsed.prices) ? parsed.prices.filter(isPricePoint) : [];

    if (prices.length === 0) {
      return null;
    }

    return {
      prices,
      source: parsed.source === "fallback" ? "fallback" : "coingecko",
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : null,
    };
  } catch (err) {
    console.error("Failed to parse cached BTC data", err);
    return null;
  }
}

function saveCachedSnapshot(snapshot: { prices: ApiPricePoint[]; source: ApiSource; fetchedAt: number }): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.error("Failed to cache BTC data", err);
  }
}

export default function TradePage() {
  const [prices, setPrices] = useState<ApiPricePoint[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const sourceRef = useRef<ApiSource | null>(null);

  useEffect(() => {
    const cached = loadCachedSnapshot();
    if (cached) {
      sourceRef.current = cached.source;
      setPrices(cached.prices);
      setLastUpdated(cached.fetchedAt);
      setStatus(cached.source === "fallback" ? "fallback" : "connected");
    }

    let cancelled = false;

    const load = async () => {
      try {
        setStatus((prev) => (prev === "connected" || prev === "fallback" ? "loading" : prev));

        const response = await fetch("/api/btc", { cache: "no-store" });
        const payload = (await response.json()) as BtcApiResponse;

        if (!response.ok || payload.error) {
          const message = payload.error ?? `CoinGecko API ${response.status}`;
          throw new Error(message);
        }

        const rawPrices = Array.isArray(payload.prices) ? payload.prices : [];
        const normalised = rawPrices.filter(isPricePoint);

        if (normalised.length === 0) {
          throw new Error("CoinGecko price data unavailable");
        }

        if (cancelled) {
          return;
        }

        const source: ApiSource = payload.source === "fallback" ? "fallback" : "coingecko";
        const fetchedAt = Date.now();

        sourceRef.current = source;
        setPrices(normalised);
        setStatus(source === "fallback" ? "fallback" : "connected");
        setError(null);
        setWarning(payload.warning ?? null);
        setLastUpdated(fetchedAt);
        saveCachedSnapshot({ prices: normalised, source, fetchedAt });
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setWarning(null);
        setStatus((prev) => {
          if (sourceRef.current) {
            return sourceRef.current === "fallback" ? "fallback" : "connected";
          }

          return prev === "loading" ? "error" : prev;
        });
      }
    };

    void load();
    const interval = window.setInterval(load, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (prices.length === 0) {
      return [];
    }

    return prices.map((point, index, arr) => {
      const start = Math.max(0, index - MOVING_AVERAGE_WINDOW + 1);
      const slice = arr.slice(start, index + 1);
      const average = slice.reduce((acc, item) => acc + item.price, 0) / Math.max(slice.length, 1);

      return {
        ...point,
        movingAverage: Number(average.toFixed(2)),
      } satisfies ChartPoint;
    });
  }, [prices]);

  const latestPoint = chartData.at(-1);
  const currentPrice = latestPoint?.price;
  const movingAverage = latestPoint?.movingAverage;
  const statusColor =
    status === "connected"
      ? "#4ade80"
      : status === "fallback"
      ? "#facc15"
      : status === "error"
      ? "#f87171"
      : "#facc15";

  const statusLabel =
    status === "connected"
      ? "Connected to CoinGecko"
      : status === "fallback"
      ? "Showing cached BTC snapshot"
      : status === "error"
      ? "Reconnecting…"
      : "Updating feed…";

  const formattedUpdatedAt = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const hasChartData = chartData.length > 0;

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <div className={styles.statusRow}>
        <span className={styles.statusIndicator} style={{ color: statusColor }} />
        <span className={styles.statusLabel}>{statusLabel}</span>
        {formattedUpdatedAt && (
          <span className={styles.lastUpdated}>
            Last update: <strong>{formattedUpdatedAt}</strong>
          </span>
        )}
      </div>

      <section className={`${layoutStyles.section} ${styles.chartCard}`}>
        <div className={styles.chartHeader}>
          <div className={styles.titleBlock}>
            <span className={layoutStyles.badge}>BTC / USD Hourly · CoinGecko</span>
            <h1 className={styles.headline}>BTC Market Pulse</h1>
            <p className={styles.subtitle}>
              Hourly outlook for Bitcoin powered by CoinGecko. Track spot price momentum with a rolling moving average overlay.
            </p>
          </div>
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Spot</span>
              <span className={styles.metricValue}>{formatUsd(currentPrice)}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Moving Avg</span>
              <span className={styles.metricValue}>{formatUsd(movingAverage)}</span>
            </div>
          </div>
        </div>

        {warning && <div className={styles.notice}>{warning}</div>}
        {error && <div className={styles.error}>Failed to refresh BTC market data: {error}</div>}

        {!hasChartData && status === "loading" && (
          <div className={styles.loading}>Loading BTC market data…</div>
        )}

        {!hasChartData && status !== "loading" && (
          <div className={styles.loading}>No BTC price data available.</div>
        )}

        {hasChartData && (
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.45)" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="rgba(255,255,255,0.45)"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(10, 10, 10, 0.9)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "0.75rem",
                    color: "#f5f5f5",
                    fontFamily: "var(--font-source-code-pro), monospace",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: number, label) => {
                    if (label === "movingAverage") {
                      return [`$${Number(value).toFixed(2)}`, "Moving Avg"];
                    }
                    return [`$${Number(value).toFixed(2)}`, "Price"];
                  }}
                  labelFormatter={(label: string, payload) => {
                    const item = payload?.[0];
                    if (item && "payload" in item && item.payload) {
                      const { timestamp } = item.payload as ChartPoint;
                      return new Date(timestamp).toLocaleString();
                    }
                    return label;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#fff35a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={800}
                  activeDot={{ r: 4, stroke: "#fff35a", strokeWidth: 2, fill: "#050505" }}
                />
                <Line
                  type="monotone"
                  dataKey="movingAverage"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="6 4"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="default" size="lg">
            Buy BTC Up
          </Button>
          <Button variant="outline" size="lg">
            Buy BTC Down
          </Button>
        </div>
      </section>
    </div>
  );
}
