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

type PricePoint = {
  timestamp: number;
  value: number;
};

type ChartPoint = {
  timestamp: number;
  time: string;
  price: number;
  movingAverage: number;
};

type Status = "loading" | "live" | "cache" | "error";

const CACHE_KEY = "degen-terminal-pyth-btc-v1";
const HISTORY_LIMIT = 12;
const HOUR_MS = 3_600_000;

function formatUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type CacheShape = {
  history: PricePoint[];
  lastUpdated: number | null;
};

function loadCachedHistory(): CacheShape | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CacheShape> & {
      history?: Array<{ timestamp?: unknown; value?: unknown }>;
    };

    const history = Array.isArray(parsed.history)
      ? parsed.history
          .map((item) => {
            const timestamp = typeof item.timestamp === "number" ? item.timestamp : Number(item.timestamp);
            const value = typeof item.value === "number" ? item.value : Number(item.value);
            if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
              return null;
            }
            return { timestamp, value } satisfies PricePoint;
          })
          .filter((point): point is PricePoint => point !== null)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-HISTORY_LIMIT)
      : [];

    if (history.length === 0) {
      return null;
    }

    const lastUpdated =
      typeof parsed.lastUpdated === "number" && Number.isFinite(parsed.lastUpdated)
        ? parsed.lastUpdated
        : history.at(-1)?.timestamp ?? null;

    return { history, lastUpdated };
  } catch (err) {
    console.error("Failed to load cached BTC history", err);
    return null;
  }
}

function saveCachedHistory(history: PricePoint[], lastUpdated: number | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (history.length === 0 || lastUpdated === null) {
    return;
  }

  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ history, lastUpdated }),
    );
  } catch (err) {
    console.error("Failed to persist BTC history", err);
  }
}

export default function TradePage() {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const hasHistoryRef = useRef(false);

  useEffect(() => {
    hasHistoryRef.current = history.length > 0;
  }, [history]);

  useEffect(() => {
    const cached = loadCachedHistory();
    if (cached) {
      setHistory(cached.history);
      setLastUpdated(cached.lastUpdated);
      setStatus("cache");
      setError(null);
      hasHistoryRef.current = true;
    }

    let cancelled = false;

    const load = async () => {
      try {
        if (!cancelled) {
          setStatus((prev) => (prev === "live" ? prev : "loading"));
        }

        const response = await fetch("/api/pyth/btc", { cache: "no-store" });
        const payload = (await response.json()) as {
          price?: unknown;
          timestamp?: unknown;
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (
          !response.ok ||
          typeof payload.price !== "number" ||
          !Number.isFinite(payload.price) ||
          typeof payload.timestamp !== "number" ||
          !Number.isFinite(payload.timestamp)
        ) {
          const message = payload.error ?? `Pyth API ${response.status}`;
          throw new Error(message);
        }

        let updatedHistory: PricePoint[] = [];
        setHistory((prev) => {
          const filtered = prev.filter((point) => point.timestamp !== payload.timestamp);
          const candidate = [...filtered, { timestamp: payload.timestamp as number, value: payload.price as number }]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-HISTORY_LIMIT);
          updatedHistory = candidate;
          return candidate;
        });

        setLastUpdated(payload.timestamp);
        setStatus("live");
        setError(null);
        hasHistoryRef.current = true;
        saveCachedHistory(updatedHistory, payload.timestamp);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setStatus(hasHistoryRef.current ? "cache" : "error");
      }
    };

    void load();
    const interval = window.setInterval(load, HOUR_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    saveCachedHistory(history, lastUpdated);
  }, [history, lastUpdated]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (history.length === 0) {
      return [];
    }

    return history.map((point, index, arr) => {
      const slice = arr.slice(Math.max(0, index - HISTORY_LIMIT + 1), index + 1);
      const movingAverage = slice.reduce((total, item) => total + item.value, 0) / Math.max(slice.length, 1);
      return {
        timestamp: point.timestamp,
        time: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        price: point.value,
        movingAverage,
      } satisfies ChartPoint;
    });
  }, [history]);

  const latestPoint = chartData.at(-1);
  const spotPrice = latestPoint?.price ?? null;
  const movingAverage = latestPoint?.movingAverage ?? null;

  const statusColor =
    status === "live"
      ? "#4ade80"
      : status === "cache"
      ? "#facc15"
      : status === "error"
      ? "#f87171"
      : "#facc15";

  const statusLabel =
    status === "live"
      ? "Live data from Pyth Network"
      : status === "cache"
      ? "Showing cached Pyth data"
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
            <span className={layoutStyles.badge}>BTC / USD Hourly · Pyth</span>
            <h1 className={styles.headline}>BTC Market Pulse</h1>
            <p className={styles.subtitle}>
              Hourly oracle updates sourced from Pyth Network with a rolling 12-hour moving average.
            </p>
          </div>
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Spot</span>
              <span className={styles.metricValue}>{formatUsd(spotPrice)}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>12h Moving Avg</span>
              <span className={styles.metricValue}>{formatUsd(movingAverage)}</span>
            </div>
          </div>
        </div>

        {error && status === "error" && (
          <div className={styles.error}>Failed to refresh BTC oracle data: {error}</div>
        )}

        {!hasChartData && status !== "error" && (
          <div className={styles.loading}>Loading BTC oracle data…</div>
        )}

        {hasChartData && (
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                key={lastUpdated ?? chartData.length}
                data={chartData}
                margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              >
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
