"use client";

import { useEffect, useState } from "react";
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
import type { LimitlessMarket } from "@/lib/limitless";

import layoutStyles from "../layout.module.css";
import styles from "./page.module.css";

type PricePoint = {
  timestamp: number;
  price: number;
};

type ChartPoint = {
  timestamp: number;
  time: string;
  timeLabel: string;
  price: number;
  movingAverage: number;
};

const MOVING_AVERAGE_WINDOW = 12; // assuming 5-minute candles -> 1 hour window

function selectBtcMarket(markets: LimitlessMarket[]): LimitlessMarket | undefined {
  return markets.find((market) => {
    const symbol = String(
      (market as { symbol?: unknown; ticker?: unknown; pair?: unknown; name?: unknown; displayName?: unknown; id?: unknown }).symbol ??
        (market as { ticker?: unknown }).ticker ??
        (market as { pair?: unknown }).pair ??
        (market as { name?: unknown }).name ??
        (market as { displayName?: unknown }).displayName ??
        market.id ??
        "",
    ).toUpperCase();

    return symbol.includes("BTC") && symbol.includes("USD");
  });
}

function normaliseSeries(market: LimitlessMarket): PricePoint[] {
  const candidateKeys = [
    "candles",
    "series",
    "history",
    "hourly",
    "prices",
    "data",
    "points",
    "records",
  ];

  for (const key of candidateKeys) {
    const value = (market as Record<string, unknown>)[key];
    if (Array.isArray(value) && value.length > 0) {
      const mapped = value
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const record = entry as Record<string, unknown>;
          const timestampRaw = record.timestamp ?? record.time ?? record.t ?? record.ts ?? null;
          const priceRaw =
            record.close ??
            record.price ??
            record.last ??
            record.value ??
            record.avgPrice ??
            record.mid ??
            record.c ??
            null;

          const price = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
          if (!Number.isFinite(price)) {
            return null;
          }

          const timestampSource = typeof timestampRaw === "number" ? timestampRaw : Number(timestampRaw);
          const timestamp = Number.isFinite(timestampSource)
            ? (timestampSource > 10_000_000_000 ? timestampSource : timestampSource * 1000)
            : Date.now() - (value.length - 1 - index) * 3_600_000;

          return {
            timestamp,
            price,
          } satisfies PricePoint;
        })
        .filter((point): point is PricePoint => Boolean(point));

      if (mapped.length > 0) {
        return mapped;
      }
    }
  }

  const fallbackPrice = (market as Record<string, unknown>).price ??
    (market as Record<string, unknown>).lastPrice ??
    (market as Record<string, unknown>).markPrice;
  if (typeof fallbackPrice === "number" && Number.isFinite(fallbackPrice)) {
    const now = Date.now();
    return [
      {
        timestamp: now - 3_600_000,
        price: fallbackPrice,
      },
      {
        timestamp: now,
        price: fallbackPrice,
      },
    ];
  }

  return [];
}

function buildChartPoints(series: PricePoint[]): ChartPoint[] {
  const sorted = [...series].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.map((point, index) => {
    const start = Math.max(0, index - MOVING_AVERAGE_WINDOW + 1);
    const windowSlice = sorted.slice(start, index + 1);
    const average =
      windowSlice.reduce((acc, item) => acc + item.price, 0) / Math.max(windowSlice.length, 1);

    return {
      timestamp: point.timestamp,
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timeLabel: new Date(point.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      price: Number(point.price.toFixed(2)),
      movingAverage: Number(average.toFixed(2)),
    } satisfies ChartPoint;
  });
}

function formatUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 100 ? 2 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function extractMarkets(payload: unknown): LimitlessMarket[] {
  if (Array.isArray(payload)) {
    return payload as LimitlessMarket[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = [record.markets, record.data, record.items, record.results];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as LimitlessMarket[];
      }
    }
  }

  return [];
}

export default function TopTradersPage() {
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [marketName, setMarketName] = useState("BTC / USD Hourly");
  const [status, setStatus] = useState<"loading" | "connected" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setStatus((prev) => (prev === "connected" ? "loading" : prev));
        const response = await fetch("/api/limitless", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Limitless API proxy ${response.status}`);
        }

        const payload = await response.json();
        const markets = extractMarkets(payload);
        const btcMarket = selectBtcMarket(markets) ?? markets[0];
        if (!btcMarket) {
          throw new Error("No markets available");
        }

        const series = normaliseSeries(btcMarket);
        if (series.length === 0) {
          throw new Error("BTC-USD market data unavailable");
        }

        if (!mounted) return;
        setMarketName(
          (btcMarket as Record<string, unknown>).name?.toString() ??
            (btcMarket as Record<string, unknown>).displayName?.toString() ??
            (btcMarket as Record<string, unknown>).title?.toString() ??
            `${btcMarket.id}`,
        );
        setChartData(buildChartPoints(series));
        setStatus("connected");
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    };

    load();
    const interval = window.setInterval(load, 60_000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const latestPoint = chartData.at(-1);
  const currentPrice = latestPoint?.price;
  const movingAverage = latestPoint?.movingAverage;
  const btcData = chartData;

  const statusColor = status === "connected" ? "#4ade80" : status === "error" ? "#f87171" : "#facc15";

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <div className={styles.statusRow}>
        <span className={styles.statusIndicator} style={{ color: statusColor }} />
        <span className={styles.statusLabel}>
          {status === "connected" ? "Connected to Limitless" : status === "error" ? "Reconnecting…" : "Updating feed…"}
        </span>
      </div>

      <section className={`${layoutStyles.section} ${styles.chartCard}`}>
        <div className={styles.chartHeader}>
          <div className={styles.titleBlock}>
            <span className={layoutStyles.badge}>{marketName}</span>
            <h1 className={styles.headline}>BTC Market Pulse</h1>
            <p className={styles.subtitle}>
              Hourly outlook for Bitcoin on Limitless. Track live momentum with a one-hour moving average overlay.
            </p>
          </div>
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Spot</span>
              <span className={styles.metricValue}>{formatUsd(currentPrice)}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>1h Moving Avg</span>
              <span className={styles.metricValue}>{formatUsd(movingAverage)}</span>
            </div>
          </div>
        </div>

        {status === "error" && error ? (
          <div className={styles.error}>Failed to load BTC market data: {error}</div>
        ) : chartData.length === 0 ? (
          <div className={styles.loading}>Loading BTC market data…</div>
        ) : (
          <div className={styles.chart}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={btcData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
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
                      return [`$${Number(value).toFixed(2)}`, "1h MA"];
                    }
                    return [`$${Number(value).toFixed(2)}`, "Price"];
                  }}
                  labelFormatter={(label: string, payload) => {
                    const item = payload?.[0];
                    if (item && "payload" in item && item.payload) {
                      const timestamp = (item.payload as ChartPoint).timestamp;
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
