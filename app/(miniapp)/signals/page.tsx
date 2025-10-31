"use client";

import { useEffect, useMemo, useState } from "react";

import layoutStyles from "../layout.module.css";
import styles from "./page.module.css";

interface TradeSummary {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  marketSlug: string | null;
  maker: string | null;
  timestamp: string;
}

interface SignalGroup {
  market: string;
  outcome: string;
  count: number;
  total: number;
  profileUrl: string;
  uniqueTraders: number;
  lastTrade: string;
}

type Status = "loading" | "connected" | "error";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export default function SignalsPage() {
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [signals, setSignals] = useState<SignalGroup[]>([]);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<Status>("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchSignals = async () => {
      try {
        const response = await fetch("/api/polymarket/trades", { cache: "no-store" });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `Status ${response.status}`);
        }

        const payload = (await response.json()) as unknown;

        const entries = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && Array.isArray((payload as { trades?: unknown[] }).trades)
          ? (payload as { trades: unknown[] }).trades
          : [];

        const parsedTrades = entries
          .map((raw) => {
            if (typeof raw !== "object" || raw === null) {
              return null;
            }

            const {
              id,
              marketId,
              marketQuestion,
              outcome,
              amount,
              marketSlug,
              maker,
              timestamp,
            } = raw as Partial<TradeSummary>;

            if (
              typeof id !== "string" ||
              typeof marketId !== "string" ||
              typeof marketQuestion !== "string" ||
              typeof outcome !== "string" ||
              typeof amount !== "number" ||
              typeof timestamp !== "string"
            ) {
              return null;
            }

            return {
              id,
              marketId,
              marketQuestion,
              outcome,
              amount,
              marketSlug: typeof marketSlug === "string" ? marketSlug : null,
              maker: typeof maker === "string" ? maker : null,
              timestamp,
            } satisfies TradeSummary;
          })
          .filter((trade): trade is TradeSummary => trade !== null);

        if (!isMounted) {
          return;
        }

        setTrades(parsedTrades);
        setError("");
        setStatus("connected");
        setLastUpdated(new Date());
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setTrades([]);
        setStatus("error");
      }
    };

    fetchSignals();
    const timer = window.setInterval(fetchSignals, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const computedSignals = useMemo<SignalGroup[]>(() => {
    const grouped = new Map<string, { market: string; outcome: string; trades: TradeSummary[] }>();

    trades.forEach((trade) => {
      const key = `${trade.marketId}__${trade.outcome}`;
      const entry = grouped.get(key);

      if (entry) {
        entry.trades.push(trade);
      } else {
        grouped.set(key, {
          market: trade.marketQuestion,
          outcome: trade.outcome,
          trades: [trade],
        });
      }
    });

    return Array.from(grouped.values())
      .filter((group) => group.trades.length >= 2)
      .map((group) => {
        const total = group.trades.reduce((sum, trade) => sum + trade.amount, 0);
        const slug = group.trades[0]?.marketSlug ?? null;
        const profileUrl = slug ? `https://polymarket.com/market/${slug}` : "https://polymarket.com/markets";
        const uniqueTraders = new Set(
          group.trades.map((trade) => (trade.maker && trade.maker.length > 0 ? trade.maker.toLowerCase() : trade.id)),
        ).size;
        const lastTrade = group.trades.reduce((latest, trade) =>
          new Date(trade.timestamp).getTime() > new Date(latest).getTime() ? trade.timestamp : latest,
        group.trades[0]?.timestamp ?? new Date().toISOString());

        return {
          market: group.market,
          outcome: group.outcome,
          count: group.trades.length,
          total,
          profileUrl,
          uniqueTraders,
          lastTrade,
        } satisfies SignalGroup;
      })
      .sort((a, b) => b.total - a.total);
  }, [trades]);

  useEffect(() => {
    setSignals(computedSignals);
  }, [computedSignals]);

  const statusClass =
    status === "connected" ? styles.connected : status === "error" ? styles.error : styles.loading;
  const statusText =
    status === "connected" ? "Connected" : status === "error" ? "Reconnecting…" : "Connecting…";

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <section className={layoutStyles.section}>
        <div className={styles.header}>
          <div className={styles.statusBar}>
            <span className={`${styles.statusIndicator} ${statusClass}`} aria-hidden="true" />
            <span className={styles.statusText}>{statusText}</span>
            {lastUpdated ? (
              <span className={layoutStyles.caption}>
                Last update {timeFormatter.format(lastUpdated)}
              </span>
            ) : null}
            {error ? <span className={styles.errorText}>{error}</span> : null}
          </div>
          <div>
            <div className={styles.kicker}>Polymarket anomaly radar</div>
            <h1 className={styles.title}>Whale Pattern Monitor</h1>
            <p className={styles.subtitle}>
              Tracking consecutive 10k+ USDC fills across the last 200 Polymarket trades. When the same market and
              outcome print back-to-back whales, they surface here for deeper review.
            </p>
          </div>
        </div>
      </section>

      <section className={layoutStyles.section}>
        {signals.length === 0 && !error ? (
          <div className={styles.empty}>No qualifying entries yet 💤</div>
        ) : null}

        {signals.length > 0 ? (
          <div className={styles.signalGrid}>
            {signals.map((signal) => {
              const highlight = signal.total >= 30_000 ? styles.highlight : undefined;
              const outcomeClass =
                signal.outcome.toLowerCase() === "yes"
                  ? styles.outcomeYes
                  : signal.outcome.toLowerCase() === "no"
                  ? styles.outcomeNo
                  : styles.outcomeNeutral;

              return (
                <a
                  key={`${signal.market}-${signal.outcome}`}
                  href={signal.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.signalCard} ${highlight ?? ""}`.trim()}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.marketLabel}>Market</span>
                    <span className={styles.market}>{signal.market}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Outcome</span>
                      <span className={`${styles.detailValue} ${outcomeClass}`}>{signal.outcome}</span>
                    </div>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Trades</span>
                      <span className={styles.detailValue}>{signal.count}</span>
                    </div>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Total Volume</span>
                      <span className={styles.detailValue}>{formatter.format(signal.total)}</span>
                    </div>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Unique Traders</span>
                      <span className={styles.detailValue}>{signal.uniqueTraders}</span>
                    </div>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Last Whale</span>
                      <span className={styles.detailValue}>
                        {timeFormatter.format(new Date(signal.lastTrade))}
                      </span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
