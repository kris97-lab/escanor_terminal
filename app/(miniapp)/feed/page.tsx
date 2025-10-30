"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "../layout.module.css";
import localStyles from "./page.module.css";

type ApiTrade = {
  id: string;
  ts: string;
  side: "BUY" | "SELL";
  amountUSD: number;
  price?: number;
  outcome?: string;
  market: string;
  url?: string;
};

type ProcessedTrade = {
  id: string;
  timestamp: number;
  market: string;
  outcome?: string;
  amount: number;
  side: "BUY" | "SELL";
  price?: number;
  url?: string;
  actor: string | null;
};

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

function buildTradeUrl(trade: ProcessedTrade): string | null {
  if (trade.url) {
    return trade.url;
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

    const existing = new Set(ledgerRef.current.map((trade) => trade.id));
    const additions = trades.filter((trade) => !existing.has(trade.id));

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

        const json = (await response.json()) as ApiTrade[] | { trades?: ApiTrade[] };
        if (!isMounted) {
          return;
        }

        const payload = Array.isArray(json)
          ? json
          : "trades" in json && Array.isArray(json.trades)
            ? json.trades
            : [];

        const processed = payload
          .map((trade) => {
            const timestamp = Date.parse(trade.ts);
            if (Number.isNaN(timestamp)) {
              return null;
            }

            const actor = typeof trade.id === "string" && trade.id.startsWith("0x") ? trade.id : null;

            return {
              id: trade.id,
              timestamp,
              market: trade.market,
              outcome: trade.outcome,
              amount: trade.amountUSD,
              side: trade.side,
              price: trade.price,
              url: trade.url,
              actor,
            } satisfies ProcessedTrade;
          })
          .filter((trade): trade is ProcessedTrade => trade !== null);

        const ordered = processed.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
        const previous = tradesRef.current;
        const previousIds = new Set(previous.map((trade) => trade.id));
        const newTradeIds = ordered.filter((trade) => !previousIds.has(trade.id)).map((trade) => trade.id);

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
            const isNew = pulseIds.includes(trade.id);
            const isWhale = trade.amount >= 10_000;
            const tradeUrl = buildTradeUrl(trade);
            const marketLabel = trade.market || "Unknown market";
            const outcomeLabel = trade.outcome || "Unknown";
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
                  <span className={localStyles.market}>{marketLabel}</span>
                  <span className={localStyles.arrow}>→</span>
                  <span className={localStyles.outcome}>{outcomeLabel}</span>
                  <span className={localStyles.amount}>({formatter.format(trade.amount)})</span>
                </div>
                <div className={localStyles.meta}>
                  <span className={localStyles.time}>{timeFormatter.format(trade.timestamp)}</span>
                  <span className={localStyles.trader}>
                    {trade.actor ? shortAddress(trade.actor) : trade.side}
                  </span>
                </div>
              </article>
            );

            return tradeUrl ? (
              <a
                key={trade.id}
                href={tradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={localStyles.entryLink}
              >
                {content}
              </a>
            ) : (
              <div key={trade.id} className={localStyles.entryWrapper}>
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
