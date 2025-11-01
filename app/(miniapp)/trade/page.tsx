"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

interface PricePoint {
  timestamp: number;
  price: number;
}

interface FeedSuccess {
  baseline: number;
  closesAt: number | null;
  prices: PricePoint[];
}

interface FeedError {
  error: string;
}

type FeedResponse = FeedSuccess | FeedError;

type Status = "loading" | "live" | "error";

function isFeedSuccess(payload: FeedResponse): payload is FeedSuccess {
  return (
    payload !== null &&
    typeof payload === "object" &&
    "baseline" in payload &&
    typeof (payload as FeedSuccess).baseline === "number" &&
    Array.isArray((payload as FeedSuccess).prices)
  );
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

function formatBaseline(baseline: number | null): string {
  if (baseline === null) {
    return "—";
  }
  return `$${baseline.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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

      setLabel(`${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`);
    };

    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [target]);

  return label;
}

export default function TradePage() {
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [closesAt, setClosesAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const countdownLabel = useCountdown(closesAt);

  const fetchFeed = useCallback(async () => {
    try {
      const response = await fetch("/api/limitless/eth", { cache: "no-store" });
      const json = (await response.json()) as FeedResponse;

      if (!response.ok || !isFeedSuccess(json)) {
        const message = isFeedSuccess(json) ? `Limitless feed error ${response.status}` : json.error;
        throw new Error(message ?? "Unknown feed error");
      }

      const normalisedSeries = json.prices
        .map((point) => {
          const timestamp = typeof point.timestamp === "number" ? point.timestamp : Number(point.timestamp);
          const price = typeof point.price === "number" ? point.price : Number(point.price);
          if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
            return null;
          }
          return { timestamp, price } satisfies PricePoint;
        })
        .filter((point): point is PricePoint => point !== null)
        .slice(-50);

      setSeries(normalisedSeries);
      setBaseline(Number.isFinite(json.baseline) ? json.baseline : null);
      const closesAtValue =
        typeof json.closesAt === "number" && Number.isFinite(json.closesAt) ? json.closesAt : null;
      setClosesAt(closesAtValue);
      setStatus("live");
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load feed";
      setError(message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!mounted) return;
      await fetchFeed();
    };

    load();
    const interval = window.setInterval(() => {
      void fetchFeed();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
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

  const baselineValue = baseline ?? null;
  const isAboveBaseline =
    baselineValue !== null && currentPrice !== null ? currentPrice >= baselineValue : false;

  const lastUpdatedLabel = formatTimestamp(lastUpdated);

  const statusLabel =
    status === "loading" ? "Syncing" : status === "error" ? "Degraded" : "Live";

  const statusClass =
    status === "live" ? styles.statusLive : status === "error" ? styles.statusError : styles.statusLoading;

  return (
    <div className={layoutStyles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.priceBlock}>
            <span className={styles.badge}>ETH · Limitless Live Market</span>
            <div className={styles.priceRow}>
              <span className={styles.spot}>{formatUsd(currentPrice)}</span>
              <span className={`${styles.delta} ${deltaClass}`}>{deltaLabel}</span>
            </div>
            <div className={styles.metaRow}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Baseline</span>
                <span className={styles.metaValue}>{formatBaseline(baselineValue)}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Countdown</span>
                <span className={styles.metaValue}>{countdownLabel}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Updated</span>
                <span className={styles.metaValue}>{lastUpdatedLabel}</span>
              </div>
              <span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span>
            </div>
          </div>
        </header>

        <div className={styles.chartShell}>
          {error && status !== "live" ? (
            <div className={styles.errorBanner}>Failed to refresh live market: {error}</div>
          ) : null}

          {chartData.length === 0 && status === "loading" ? (
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
                {baselineValue !== null ? (
                  <ReferenceLine
                    y={baselineValue}
                    stroke="#ff6b6b"
                    strokeDasharray="6 4"
                    label={{ value: "Baseline", position: "right", fill: "#ff6b6b", fontSize: 11 }}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#fff35a"
                  strokeWidth={2.4}
                  dot={false}
                  isAnimationActive
                  animationDuration={500}
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
            className={isAboveBaseline ? styles.aboveActive : undefined}
          >
            Above {formatBaseline(baselineValue)}
          </Button>
          <Button
            variant="outline"
            size="lg"
            block
            className={!isAboveBaseline ? styles.belowActive : undefined}
          >
            Below {formatBaseline(baselineValue)}
          </Button>
        </div>

        <p className={styles.footerNote}>Live data refreshes every 2 seconds · Powered by Limitless Exchange</p>
      </section>
    </div>
  );
}
