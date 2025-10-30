"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import layoutStyles from "../layout.module.css";
import styles from "./page.module.css";

type ApiTrade = {
  id: string;
  ts: string;
  side: "BUY" | "SELL";
  amountUSD: number;
  price?: number;
  outcome?: string;
  market: string;
  marketId: string;
  url?: string;
};

type Signal = {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  count: number;
  totalVolume: number;
  lastTradeTime: number;
};

type ConnectionState = "loading" | "connected" | "error";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function parseTrades(json: unknown): ApiTrade[] {
  if (Array.isArray(json)) {
    return json as ApiTrade[];
  }

  if (json && typeof json === "object" && "trades" in json) {
    const possible = (json as { trades?: unknown }).trades;
    if (Array.isArray(possible)) {
      return possible as ApiTrade[];
    }
  }

  return [];
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return "just now";
  }

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h ago` : `${hours}h ${remainder}m ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function useSignalRecorder(signals: Signal[]) {
  const ledgerRef = useRef<Signal[]>([]);

  useEffect(() => {
    if (signals.length === 0) {
      return;
    }

    const existing = new Map(ledgerRef.current.map((signal) => [signal.marketId + signal.outcome, signal]));
    const additions = signals.filter((signal) => !existing.has(signal.marketId + signal.outcome));

    if (additions.length > 0) {
      ledgerRef.current = [...additions, ...ledgerRef.current].slice(0, 1000);
    }
  }, [signals]);

  return useMemo(() => ({
    ledgerRef,
    snapshot: () => ledgerRef.current.slice(),
  }), []);
}

export default function SignalsPage() {
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());

  const previousKeysRef = useRef<Set<string>>(new Set());
  const { snapshot } = useSignalRecorder(signals);
  const persistenceDraftRef = useRef<Signal[]>([]);

  useEffect(() => {
    persistenceDraftRef.current = snapshot();
  }, [snapshot, signals]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const response = await fetch("/api/trades", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = parseTrades(await response.json());
        if (!isMounted) {
          return;
        }

        const filtered = payload.filter((trade) => Number(trade.amountUSD ?? 0) >= 800);

        const grouped = new Map<string, Signal>();

        for (const trade of filtered) {
          const key = `${trade.marketId ?? trade.market}-${(trade.outcome ?? "Unknown").toUpperCase()}`;
          const timestamp = Date.parse(trade.ts);
          if (Number.isNaN(timestamp)) {
            continue;
          }

          const existing = grouped.get(key);
          if (existing) {
            existing.count += 1;
            existing.totalVolume += Number(trade.amountUSD ?? 0);
            if (timestamp > existing.lastTradeTime) {
              existing.lastTradeTime = timestamp;
            }
          } else {
            grouped.set(key, {
              marketId: trade.marketId ?? trade.market,
              marketQuestion: trade.market,
              outcome: trade.outcome ?? "Unknown",
              count: 1,
              totalVolume: Number(trade.amountUSD ?? 0),
              lastTradeTime: timestamp,
            });
          }
        }

        const nextSignals = Array.from(grouped.values())
          .filter((group) => group.count >= 3)
          .sort((a, b) => b.lastTradeTime - a.lastTradeTime)
          .slice(0, 100);

        const previousKeys = previousKeysRef.current;
        const nextKeys = new Set(nextSignals.map((signal) => `${signal.marketId}-${signal.outcome.toUpperCase()}`));
        const newHighlights = new Set<string>();

        for (const key of nextKeys) {
          if (!previousKeys.has(key)) {
            newHighlights.add(key);
          }
        }

        previousKeysRef.current = nextKeys;
        setSignals(nextSignals);
        setHighlightKeys(newHighlights);
        setConnection("connected");
      } catch {
        if (!isMounted) {
          return;
        }
        setConnection("error");
      }
    };

    load();
    const interval = window.setInterval(load, 10_000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (highlightKeys.size === 0) {
      return;
    }

    const timeout = window.setTimeout(() => setHighlightKeys(new Set()), 1200);
    return () => window.clearTimeout(timeout);
  }, [highlightKeys]);

  const statusText =
    connection === "connected"
      ? "🟢 Connected"
      : connection === "error"
        ? "🔴 Reconnecting…"
        : "🟡 Connecting…";

  return (
    <div className={`${layoutStyles.page} ${styles.page}`}>
      <header className={styles.header}>
        <span className={styles.kicker}>Degen Terminal · Polymarket Edition</span>
        <h1 className={styles.title}>Signals Detector</h1>
        <p className={styles.subtitle}>
          Auto-detected clusters of high-value Polymarket trades. The feed refreshes every ten seconds to surface
          actionable patterns across outcomes.
        </p>
      </header>

      <div className={styles.statusBar}>
        <span className={`${styles.statusIndicator} ${styles[connection]}`} />
        <span className={styles.statusText}>{statusText}</span>
      </div>

      {signals.length === 0 ? (
        <div className={styles.empty}>Waiting for patterns…</div>
      ) : (
        <section className={styles.signalGrid}>
          {signals.map((signal) => {
            const key = `${signal.marketId}-${signal.outcome.toUpperCase()}`;
            const isHighlighted = highlightKeys.has(key);
            const outcomeClass =
              signal.outcome.toLowerCase() === "yes"
                ? styles.outcomeYes
                : signal.outcome.toLowerCase() === "no"
                  ? styles.outcomeNo
                  : styles.outcomeNeutral;

            return (
              <article
                key={key}
                className={`${styles.signalCard} ${isHighlighted ? styles.highlight : ""}`.trim()}
              >
                <header className={styles.cardHeader}>
                  <span className={styles.marketLabel}>🟢 Market</span>
                  <span className={styles.market}>{signal.marketQuestion}</span>
                </header>
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
                    <span className={styles.detailLabel}>Volume</span>
                    <span className={styles.detailValue}>{currency.format(signal.totalVolume)}</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Last Trade</span>
                    <span className={styles.detailValue}>{timeAgo(signal.lastTradeTime)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
