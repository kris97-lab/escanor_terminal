"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "../layout.module.css";
import localStyles from "./page.module.css";

type ApiTrade = {
  tradeId: string;
  marketQuestion: string;
  marketId: string | null;
  outcome: string;
  amount: number;
  trader: string | null;
  createdAt: string;
};

type ProcessedTrade = ApiTrade & { timestamp: number };

type ConnectionState = "loading" | "connected" | "error";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function buildTradeUrl(trade: ApiTrade): string | null {
  if (trade.marketId) {
    return `https://polymarket.com/market/${trade.marketId}`;
  }

  return null;
}

function shortAddress(address: string | null): string {
  if (!address) {
    return "Unknown trader";
  }
  if (address.length <= 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function useTradeRecorder(trades: ProcessedTrade[]) {
  const ledgerRef = useRef<ProcessedTrade[]>([]);

  useEffect(() => {
    if (trades.length === 0) {
      return;
    }

    const existing = new Set(ledgerRef.current.map((trade) => trade.tradeId));
    const additions = trades.filter((trade) => !existing.has(trade.tradeId));

    if (additions.length > 0) {
      ledgerRef.current = [...additions, ...ledgerRef.current].slice(0, 5000);
    }
  }, [trades]);

  const prepareForPersist = useCallback(() => ledgerRef.current.slice(), []);

  return useMemo(
    () => ({
      ledgerRef,
      prepareForPersist,
    }),
    [prepareForPersist],
  );
}

export default function FeedPage() {
  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [trades, setTrades] = useState<ProcessedTrade[]>([]);
  const [pulseIds, setPulseIds] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const tradesRef = useRef<ProcessedTrade[]>([]);
  const { prepareForPersist } = useTradeRecorder(trades);
  const persistenceDraftRef = useRef<ProcessedTrade[]>([]);

  useEffect(() => {
    persistenceDraftRef.current = prepareForPersist();
  }, [prepareForPersist, trades]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const response = await fetch("/api/trades", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const json = (await response.json()) as { trades?: ApiTrade[] };
        if (!isMounted) {
          return;
        }

        const processed = Array.isArray(json.trades)
          ? json.trades
              .map((trade) => {
                const timestamp = Date.parse(trade.createdAt);
                if (Number.isNaN(timestamp)) {
                  return null;
                }

                return { ...trade, timestamp } satisfies ProcessedTrade;
              })
              .filter((trade): trade is ProcessedTrade => trade !== null)
          : [];

        const ordered = processed.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
        const previous = tradesRef.current;
        const previousIds = new Set(previous.map((trade) => trade.tradeId));
        const newTradeIds = ordered.filter((trade) => !previousIds.has(trade.tradeId)).map((trade) => trade.tradeId);

        tradesRef.current = ordered;
        setTrades(ordered);
        setLastUpdated(Date.now());
        if (newTradeIds.length > 0) {
          setPulseIds(newTradeIds);
        }
        setConnection("connected");
      } catch {
        if (!isMounted) {
          return;
        }
        setConnection("error");
      }
    };

    load();
    const interval = window.setInterval(load, 3000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (pulseIds.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => setPulseIds([]), 1200);
    return () => window.clearTimeout(timeout);
  }, [pulseIds]);

  const statusText =
    connection === "connected"
      ? "🟢 Connected"
      : connection === "error"
        ? "🔴 Reconnecting…"
        : "🟡 Connecting…";

  const lastUpdatedLabel = lastUpdated ? timeFormatter.format(lastUpdated) : null;

  return (
    <div className={`${styles.page} ${localStyles.page}`}>
      <header className={localStyles.hero}>
        <span className={localStyles.kicker}>Degen Terminal · Polymarket Edition</span>
        <h1 className={localStyles.title}>Feed</h1>
        <p className={localStyles.subtitle}>
          Stream of Polymarket trades above 799&nbsp;USDC. Updates every three seconds for a near real-time desk view.
        </p>
      </header>

      <section className={localStyles.panel}>
        <div className={localStyles.statusRow}>
          <span className={`${localStyles.statusIndicator} ${localStyles[connection]}`} />
          <span className={localStyles.statusText}>{statusText}</span>
          {lastUpdatedLabel && connection === "connected" ? (
            <span className={localStyles.timestamp}>Synced {lastUpdatedLabel} UTC</span>
          ) : null}
        </div>

        <div className={localStyles.feed}>
          {trades.map((trade) => {
            const isNew = pulseIds.includes(trade.tradeId);
            const isWhale = trade.amount >= 10_000;
            const tradeUrl = buildTradeUrl(trade);
            const entryClassNames = [
              localStyles.entry,
              isWhale ? localStyles.hugeTrade : localStyles.standardTrade,
              isNew ? localStyles.entryEnter : "",
            ]
              .filter(Boolean)
              .join(" ");

            const content = (
              <article className={entryClassNames}>
                <div className={localStyles.summary}>
                  <span className={localStyles.market}>{trade.marketQuestion}</span>
                  <span className={localStyles.arrow}>→</span>
                  <span className={localStyles.outcome}>{trade.outcome}</span>
                  <span className={localStyles.amount}>({formatter.format(trade.amount)})</span>
                </div>
                <div className={localStyles.meta}>
                  <span className={localStyles.time}>{timeFormatter.format(trade.timestamp)}</span>
                  <span className={localStyles.trader}>{shortAddress(trade.trader)}</span>
                </div>
              </article>
            );

            return tradeUrl ? (
              <a
                key={trade.tradeId}
                href={tradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={localStyles.entryLink}
              >
                {content}
              </a>
            ) : (
              <div key={trade.tradeId} className={localStyles.entryWrapper}>
                {content}
              </div>
            );
          })}

          {trades.length === 0 ? (
            <div className={localStyles.emptyState}>
              {connection === "error" ? "Reconnecting…" : "No trades yet…"}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
