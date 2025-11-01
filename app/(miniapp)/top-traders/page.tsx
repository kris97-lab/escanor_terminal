"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import fallbackData from "@/data/btc-fallback.json";
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

type CachePayload = {
  history: PricePoint[];
  lastUpdated: number;
};

type FallbackShape = {
  prices?: Array<{ timestamp: number; price: number }>;
};

const HOUR_MS = 3_600_000;
const HISTORY_LIMIT = 12;
const CACHE_KEY = "degen-terminal-pyth-btc-v3";

const FALLBACK_SERIES: PricePoint[] = (() => {
  const typed = fallbackData as FallbackShape;
  const series = Array.isArray(typed.prices) ? typed.prices : [];
  if (series.length === 0) {
    return [];
  }

  const anchor = series.at(-1)?.timestamp ?? Date.now();
  const offset = Date.now() - anchor;

  return series
    .map((point) => {
      const timestamp = Number(point.timestamp) + offset;
      const price = Number(point.price);
      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
        return null;
      }
      return { timestamp, value: price } satisfies PricePoint;
    })
    .filter((point): point is PricePoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-HISTORY_LIMIT);
})();

function formatUsd(value?: number | null, options?: Intl.NumberFormatOptions): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  })}`;
}

function formatCountdown(ms: number | null): string {
  if (ms === null) {
    return "—";
  }

  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadCache(): CachePayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachePayload> & {
      history?: Array<{ timestamp?: unknown; value?: unknown }>;
    };

    const history = Array.isArray(parsed.history)
      ? parsed.history
          .map((point) => {
            const timestamp = typeof point.timestamp === "number" ? point.timestamp : Number(point.timestamp);
            const value = typeof point.value === "number" ? point.value : Number(point.value);
            if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
              return null;
            }
            return { timestamp, value } satisfies PricePoint;
          })
          .filter((point): point is PricePoint => point !== null)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-HISTORY_LIMIT)
      : [];

    if (history.length === 0 || typeof parsed.lastUpdated !== "number") {
      return null;
    }

    return { history, lastUpdated: parsed.lastUpdated };
  } catch (err) {
    console.error("Failed to read cached BTC feed", err);
    return null;
  }
}

function persistCache(payload: CachePayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("Failed to persist BTC feed", err);
  }
}

export default function TradePage() {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setHistory(cached.history);
      setLastUpdated(cached.lastUpdated);
      setStatus("cache");
    } else if (FALLBACK_SERIES.length > 0) {
      setHistory(FALLBACK_SERIES);
      setLastUpdated(FALLBACK_SERIES.at(-1)?.timestamp ?? null);
      setStatus("cache");
    }
  }, []);

  useEffect(() => {
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

        const nextPoint: PricePoint = {
          timestamp: payload.timestamp,
          value: payload.price,
        };

        setHistory((prev) => {
          const filtered = prev.filter((point) => point.timestamp !== nextPoint.timestamp);
          const candidate = [...filtered, nextPoint]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-HISTORY_LIMIT);
          persistCache({ history: candidate, lastUpdated: nextPoint.timestamp });
          return candidate;
        });

        setLastUpdated(nextPoint.timestamp);
        setStatus("live");
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setStatus((prev) => (prev === "live" || prev === "cache" ? "cache" : "error"));
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
    if (lastUpdated === null) {
      setCountdown(null);
      return;
    }

    const tick = () => {
      const now = Date.now();
      const nextUpdate = lastUpdated + HOUR_MS;
      setCountdown(Math.max(nextUpdate - now, 0));
    };

    tick();
    const timer = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [lastUpdated]);

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

  const latestPoint = chartData.at(-1) ?? null;
  const firstPoint = chartData[0] ?? null;

  const spotPrice = latestPoint?.price ?? null;
  const movingAverage = latestPoint?.movingAverage ?? null;

  const changePct = useMemo(() => {
    if (!latestPoint || !firstPoint || firstPoint.price === 0) {
      return null;
    }
    const delta = ((latestPoint.price - firstPoint.price) / firstPoint.price) * 100;
    return delta;
  }, [firstPoint, latestPoint]);

  const sentiment = useMemo(() => {
    if (changePct === null || !Number.isFinite(changePct)) {
      return { bulls: 50, bears: 50, summary: "Awaiting new activity" } as const;
    }

    const bulls = Math.round(clamp(50 + changePct * 2, 5, 95));
    const bears = 100 - bulls;
    const summary = changePct >= 0 ? "Traders leaning bullish" : "Defensive positioning rising";

    return { bulls, bears, summary } as const;
  }, [changePct]);

  const statusLabel =
    status === "live"
      ? "Live feed"
      : status === "cache"
      ? "Cached snapshot"
      : status === "error"
      ? "Reconnecting"
      : "Updating";

  const hasChartData = chartData.length > 1;

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <section className={styles.tradeCard}>
        <header className={styles.header}>
          <div className={styles.priceBlock}>
            <span className={styles.badge}>BTC · PYTH ORACLE</span>
            <div className={styles.priceRow}>
              <span className={styles.spot}>{formatUsd(spotPrice)}</span>
              {changePct !== null && Number.isFinite(changePct) && (
                <span
                  className={`${styles.delta} ${changePct >= 0 ? styles.positive : styles.negative}`}
                >
                  {changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%
                </span>
              )}
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Updated</span>
              <span className={styles.metaValue}>
                {lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
              <span className={styles.statusPill} data-state={status}>
                {statusLabel}
              </span>
            </div>
          </div>

          <div className={styles.countdownBlock}>
            <span className={styles.countdownLabel}>Next oracle update</span>
            <span className={styles.countdownValue}>{formatCountdown(countdown)}</span>
            <span className={styles.secondaryMeta}>12h moving avg · {formatUsd(movingAverage)}</span>
          </div>
        </header>

        <div className={styles.chartShell}>
          {error && status === "error" && (
            <div className={styles.errorBanner}>Failed to refresh BTC oracle data: {error}</div>
          )}

          {!hasChartData && status !== "error" && (
            <div className={styles.loading}>Loading BTC oracle history…</div>
          )}

          {hasChartData && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
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
                    background: "rgba(12, 12, 12, 0.94)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "0.75rem",
                    fontFamily: "var(--font-source-code-pro), monospace",
                    fontSize: "0.75rem",
                    color: "#f5f5f5",
                  }}
                  formatter={(value: number, key) => [`$${Number(value).toFixed(2)}`, key === "movingAverage" ? "Moving Avg" : "Price"]}
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
                  strokeWidth={2.4}
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
          )}
        </div>

        <div className={styles.actionsRow}>
          <Button variant="default" size="lg" block>
            Above {formatUsd(spotPrice, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Button>
          <Button variant="outline" size="lg" block>
            Below {formatUsd(spotPrice, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Button>
        </div>

        <div className={styles.sentimentCard}>
          <div className={styles.sentimentHeader}>Community Sentiment</div>
          <div className={styles.sentimentTrack}>
            <div className={styles.sentimentBull} style={{ width: `${sentiment.bulls}%` }} />
            <div className={styles.sentimentBear} style={{ width: `${sentiment.bears}%` }} />
          </div>
          <div className={styles.sentimentLegend}>
            <span className={styles.bullLabel}>↑ {sentiment.bulls}% expect BTC to rise</span>
            <span className={styles.bearLabel}>↓ {sentiment.bears}% hedging downside</span>
          </div>
          <p className={styles.sentimentSummary}>{sentiment.summary}</p>
        </div>
      </section>
    </div>
  );
}
