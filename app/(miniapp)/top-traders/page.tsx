"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type OraclePoint = {
  timestamp: number;
  value: number;
};

type MarketPoint = {
  timestamp: number;
  value: number;
};

type ChartPoint = {
  timestamp: number;
  time: string;
  oracle?: number;
  market?: number;
};

type Status = "loading" | "live" | "cache" | "error";

type CachePayload = {
  oracleHistory: OraclePoint[];
  marketHistory: MarketPoint[];
  lastUpdated: number;
};

type FallbackShape = {
  prices?: Array<{ timestamp: number; price: number }>;
};

const HOUR_MS = 3_600_000;
const ORACLE_HISTORY_LIMIT = 12;
const MARKET_HISTORY_LIMIT = 48;
const CACHE_KEY = "degen-terminal-btc-dual-oracle";

const FALLBACK_ORACLE: OraclePoint[] = (() => {
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
      return { timestamp, value: price } satisfies OraclePoint;
    })
    .filter((point): point is OraclePoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-ORACLE_HISTORY_LIMIT);
})();

const FALLBACK_MARKET: MarketPoint[] = FALLBACK_ORACLE.map((point, index) => ({
  timestamp: point.timestamp,
  value: point.value * (index % 2 === 0 ? 0.998 : 1.002),
})).slice(-MARKET_HISTORY_LIMIT);

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

function parseCachedSeries(input: unknown, limit: number): Array<{ timestamp: number; value: number }> {
  if (!Array.isArray(input)) {
    return [];
  }

  return (input as Array<Record<string, unknown>>)
    .map((entry) => {
      const timestampValue = entry?.timestamp ?? entry?.time;
      const rawTimestamp =
        typeof timestampValue === "number"
          ? timestampValue
          : typeof timestampValue === "string"
          ? Number(timestampValue)
          : Number.NaN;

      const fallbackTimestamp =
        typeof timestampValue === "string" ? Date.parse(timestampValue) : Number.NaN;

      const timestamp = Number.isFinite(rawTimestamp)
        ? rawTimestamp
        : Number.isFinite(fallbackTimestamp)
        ? fallbackTimestamp
        : Number.NaN;

      const rawValueCandidate = entry?.["value"] ?? entry?.["price"] ?? entry?.["marketPrice"];
      const rawValue =
        typeof rawValueCandidate === "number"
          ? rawValueCandidate
          : typeof rawValueCandidate === "string"
          ? Number(rawValueCandidate)
          : Number.NaN;

      const value = Number.isFinite(rawValue) ? Number(rawValue) : Number.NaN;

      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
        return null;
      }

      const normalisedTimestamp = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;

      return { timestamp: Math.trunc(normalisedTimestamp), value };
    })
    .filter((point): point is { timestamp: number; value: number } => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit);
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
      oracleHistory?: unknown;
      marketHistory?: unknown;
    };

    const oracleHistory = parseCachedSeries(parsed.oracleHistory, ORACLE_HISTORY_LIMIT);
    const marketHistory = parseCachedSeries(parsed.marketHistory, MARKET_HISTORY_LIMIT);

    if (oracleHistory.length === 0 && marketHistory.length === 0) {
      return null;
    }

    const candidateLastUpdated = Number(parsed.lastUpdated);
    const lastUpdated = Number.isFinite(candidateLastUpdated)
      ? candidateLastUpdated
      : oracleHistory.at(-1)?.timestamp ?? null;

    if (!Number.isFinite(lastUpdated ?? NaN)) {
      return null;
    }

    return {
      oracleHistory,
      marketHistory,
      lastUpdated: Number(lastUpdated),
    } satisfies CachePayload;
  } catch (err) {
    console.error("Failed to read cached BTC oracle snapshot", err);
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
    console.error("Failed to persist BTC oracle snapshot", err);
  }
}

function normaliseLimitlessSeries(limitless: unknown): MarketPoint[] {
  if (!Array.isArray(limitless)) {
    return [];
  }

  return (limitless as Array<Record<string, unknown>>)
    .map((entry) => {
      const timestampValue = entry?.timestamp;
      const rawTimestamp =
        typeof timestampValue === "number"
          ? timestampValue
          : typeof timestampValue === "string"
          ? Number(timestampValue)
          : Number.NaN;

      const fallbackTimestamp =
        typeof timestampValue === "string" ? Date.parse(timestampValue) : Number.NaN;

      const timestamp = Number.isFinite(rawTimestamp)
        ? rawTimestamp
        : Number.isFinite(fallbackTimestamp)
        ? fallbackTimestamp
        : Number.NaN;

      const rawPriceCandidate = entry?.["marketPrice"] ?? entry?.["price"] ?? entry?.["value"];
      const rawPrice =
        typeof rawPriceCandidate === "number"
          ? rawPriceCandidate
          : typeof rawPriceCandidate === "string"
          ? Number(rawPriceCandidate)
          : Number.NaN;

      if (!Number.isFinite(timestamp) || !Number.isFinite(rawPrice)) {
        return null;
      }

      const adjustedPrice = Number(rawPrice) < 10 ? Number(rawPrice) * 100 : Number(rawPrice);

      const normalisedTimestamp = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;

      return { timestamp: Math.trunc(normalisedTimestamp), value: adjustedPrice } satisfies MarketPoint;
    })
    .filter((point): point is MarketPoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MARKET_HISTORY_LIMIT);
}

export default function TradePage() {
  const [oracleHistory, setOracleHistory] = useState<OraclePoint[]>([]);
  const [marketHistory, setMarketHistory] = useState<MarketPoint[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const oracleRef = useRef<OraclePoint[]>([]);
  const marketRef = useRef<MarketPoint[]>([]);

  useEffect(() => {
    oracleRef.current = oracleHistory;
  }, [oracleHistory]);

  useEffect(() => {
    marketRef.current = marketHistory;
  }, [marketHistory]);

  useEffect(() => {
    const cached = loadCache();
    if (cached) {
      setOracleHistory(cached.oracleHistory);
      setMarketHistory(cached.marketHistory);
      setLastUpdated(cached.lastUpdated);
      setStatus("cache");
      return;
    }

    if (FALLBACK_ORACLE.length > 0) {
      setOracleHistory(FALLBACK_ORACLE);
      setMarketHistory(FALLBACK_MARKET);
      setLastUpdated(FALLBACK_ORACLE.at(-1)?.timestamp ?? null);
      setStatus("cache");
    }
  }, []);

  const fetchFeeds = useCallback(async () => {
    try {
      setStatus((prev) => (prev === "live" ? "live" : "loading"));

      const response = await fetch("/api/oracle/btc", { cache: "no-store" });
      const payload = (await response.json()) as {
        pyth?: { price?: unknown; timestamp?: unknown };
        limitless?: unknown;
        error?: string;
      };

      if (
        !response.ok ||
        typeof payload?.pyth?.price !== "number" ||
        !Number.isFinite(payload.pyth.price) ||
        typeof payload.pyth.timestamp !== "number" ||
        !Number.isFinite(payload.pyth.timestamp)
      ) {
        const message = payload?.error ?? `Oracle API ${response.status}`;
        throw new Error(message);
      }

      const oraclePoint: OraclePoint = {
        timestamp: Math.trunc(payload.pyth.timestamp),
        value: payload.pyth.price,
      };

      const nextOracleHistory = (() => {
        const deduped = oracleRef.current.filter((point) => point.timestamp !== oraclePoint.timestamp);
        return [...deduped, oraclePoint]
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-ORACLE_HISTORY_LIMIT);
      })();

      const nextMarketHistory = (() => {
        const normalised = normaliseLimitlessSeries(payload.limitless);
        if (normalised.length === 0) {
          return marketRef.current;
        }
        return normalised;
      })();

      setOracleHistory(nextOracleHistory);
      setMarketHistory(nextMarketHistory);
      oracleRef.current = nextOracleHistory;
      marketRef.current = nextMarketHistory;

      setLastUpdated(oraclePoint.timestamp);
      setStatus("live");
      setError(null);

      persistCache({
        oracleHistory: nextOracleHistory,
        marketHistory: nextMarketHistory,
        lastUpdated: oraclePoint.timestamp,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setStatus(oracleRef.current.length > 0 || marketRef.current.length > 0 ? "cache" : "error");
    }
  }, []);

  useEffect(() => {
    void fetchFeeds();
    const interval = window.setInterval(fetchFeeds, HOUR_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [fetchFeeds]);

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
    if (oracleHistory.length === 0 && marketHistory.length === 0) {
      return [];
    }

    const map = new Map<number, { oracle?: number; market?: number }>();

    for (const point of marketHistory) {
      const entry = map.get(point.timestamp) ?? {};
      entry.market = point.value;
      map.set(point.timestamp, entry);
    }

    for (const point of oracleHistory) {
      const entry = map.get(point.timestamp) ?? {};
      entry.oracle = point.value;
      map.set(point.timestamp, entry);
    }

    const sorted = Array.from(map.entries())
      .map(([timestamp, value]) => ({ timestamp, ...value }))
      .sort((a, b) => a.timestamp - b.timestamp);

    let lastOracle: number | undefined;

    return sorted.map((entry) => {
      if (typeof entry.oracle === "number") {
        lastOracle = entry.oracle;
      }

      const oracle = typeof entry.oracle === "number" ? entry.oracle : lastOracle;

      return {
        timestamp: entry.timestamp,
        time: new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        oracle,
        market: typeof entry.market === "number" ? entry.market : undefined,
      } satisfies ChartPoint;
    });
  }, [marketHistory, oracleHistory]);

  const spotPrice = oracleHistory.at(-1)?.value ?? null;
  const movingAverage = useMemo(() => {
    if (oracleHistory.length === 0) {
      return null;
    }
    const slice = oracleHistory.slice(-ORACLE_HISTORY_LIMIT);
    const total = slice.reduce((sum, point) => sum + point.value, 0);
    return total / slice.length;
  }, [oracleHistory]);

  const changePct = useMemo(() => {
    if (oracleHistory.length < 2) {
      return null;
    }
    const first = oracleHistory[0];
    const last = oracleHistory[oracleHistory.length - 1];
    if (!first || !last || first.value === 0) {
      return null;
    }
    return ((last.value - first.value) / first.value) * 100;
  }, [oracleHistory]);

  const latestMarketPrice = marketHistory.at(-1)?.value ?? null;
  const marketDisplayPrice =
    latestMarketPrice !== null && latestMarketPrice > 1000 ? latestMarketPrice : null;

  const basisSpread =
    spotPrice !== null && marketDisplayPrice !== null && spotPrice > 0
      ? ((marketDisplayPrice - spotPrice) / spotPrice) * 100
      : null;

  const statusLabel =
    status === "live"
      ? "Dual feed live"
      : status === "cache"
      ? "Cached snapshot"
      : status === "error"
      ? "Reconnecting"
      : "Updating";

  const hasChartData = chartData.length > 1 && chartData.some((point) => {
    const oracleOk = typeof point.oracle === "number" && Number.isFinite(point.oracle);
    const marketOk = typeof point.market === "number" && Number.isFinite(point.market);
    return oracleOk || marketOk;
  });

  const spreadLabel =
    basisSpread !== null && Number.isFinite(basisSpread)
      ? `${basisSpread >= 0 ? "+" : ""}${basisSpread.toFixed(2)}%`
      : null;

  const sentiment = useMemo(() => {
    if (basisSpread !== null && Number.isFinite(basisSpread)) {
      const bulls = Math.round(clamp(50 + basisSpread * 5, 5, 95));
      const bears = 100 - bulls;
      const summary =
        basisSpread >= 0
          ? "Limitless market pricing upside premium"
          : "Limitless market hedging downside";
      return { bulls, bears, summary } as const;
    }

    if (changePct !== null && Number.isFinite(changePct)) {
      const bulls = Math.round(clamp(50 + changePct * 2, 5, 95));
      const bears = 100 - bulls;
      const summary = changePct >= 0 ? "Traders leaning bullish" : "Defensive positioning rising";
      return { bulls, bears, summary } as const;
    }

    return { bulls: 50, bears: 50, summary: "Awaiting oracle confirmation" } as const;
  }, [basisSpread, changePct]);

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <section className={styles.tradeCard}>
        <header className={styles.header}>
          <div className={styles.priceBlock}>
            <span className={styles.badge}>BTC · DUAL ORACLE</span>
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
                {lastUpdated
                  ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </span>
              {marketDisplayPrice !== null && (
                <>
                  <span className={styles.metaLabel}>Limitless</span>
                  <span className={styles.metaValue}>{formatUsd(marketDisplayPrice)}</span>
                </>
              )}
              <span className={styles.statusPill} data-state={status}>
                {statusLabel}
              </span>
            </div>
          </div>

          <div className={styles.countdownBlock}>
            <span className={styles.countdownLabel}>Next oracle update</span>
            <span className={styles.countdownValue}>{formatCountdown(countdown)}</span>
            <span className={styles.secondaryMeta}>
              12h moving avg · {formatUsd(movingAverage)}
              {spreadLabel ? ` · Spread ${spreadLabel}` : ""}
            </span>
          </div>
        </header>

        <div className={styles.chartShell}>
          {error && status === "error" && (
            <div className={styles.errorBanner}>Failed to refresh oracle feeds: {error}</div>
          )}

          {!hasChartData && status !== "error" && (
            <div className={styles.loading}>Syncing oracle feeds…</div>
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
                  formatter={(value: number | string | Array<number | string>, key) => {
                    if (typeof value !== "number") {
                      return ["—", key];
                    }
                    const label =
                      key === "oracle"
                        ? "Pyth Oracle"
                        : key === "market"
                        ? "Limitless Market"
                        : key;
                    return [`$${Number(value).toFixed(2)}`, label];
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
                  dataKey="oracle"
                  stroke="#fff35a"
                  strokeWidth={2.4}
                  dot={false}
                  isAnimationActive
                  animationDuration={800}
                  activeDot={{ r: 4, stroke: "#fff35a", strokeWidth: 2, fill: "#050505" }}
                />
                <Line
                  type="monotone"
                  dataKey="market"
                  stroke="#00ffd1"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={800}
                  strokeDasharray="6 3"
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
            <span className={styles.bullLabel}>↑ {sentiment.bulls}% favour upside</span>
            <span className={styles.bearLabel}>↓ {sentiment.bears}% hedging downside</span>
          </div>
          <p className={styles.sentimentSummary}>{sentiment.summary}</p>
        </div>
      </section>
    </div>
  );
}
