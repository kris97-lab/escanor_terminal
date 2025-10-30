"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "../layout.module.css";
import localStyles from "./page.module.css";

const POLYMARKET_ENDPOINT = "https://gamma-api.polymarket.com/trades?limit=100";

type ConnectionState = "loading" | "connected" | "error";

type ProcessedTrade = {
  id: string;
  marketTitle: string;
  outcome: string;
  amount: number;
  createdAt: string;
  timestamp: number;
  url: string;
};

type RawTrade = Record<string, unknown>;

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function parseAmount(raw: RawTrade): number {
  const candidates = [
    raw.amount,
    raw.value,
    raw.cost,
    raw.usdcAmount,
    raw.usdc_size,
    raw.usdc,
    raw.makerAmount,
    raw.takerAmount,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      return candidate;
    }

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const maybe = Number(candidate);
      if (!Number.isNaN(maybe)) {
        return maybe;
      }
    }
  }

  const price = typeof raw.price === "string" ? Number(raw.price) : raw.price;
  const size = typeof raw.size === "string" ? Number(raw.size) : raw.size;

  if (typeof price === "number" && typeof size === "number") {
    return price * size;
  }

  return 0;
}

function extractOutcome(raw: RawTrade): string {
  const candidates = [
    raw.outcome,
    raw.outcomeName,
    raw.tokenOutcome,
    raw.marketOutcome,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return "Unknown";
}

function extractMarketTitle(raw: RawTrade): string {
  const market = raw.market as RawTrade | undefined;
  const candidates = [
    market?.question,
    market?.title,
    market?.name,
    raw.marketQuestion,
    raw.marketTitle,
    raw.question,
    raw.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return "Untitled Market";
}

function extractSlug(raw: RawTrade): string | undefined {
  const market = raw.market as RawTrade | undefined;
  const candidates = [market?.slug, raw.marketSlug, raw.slug, raw.market_slug];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function extractCreatedAt(raw: RawTrade): string | undefined {
  const candidates = [
    raw.createdAt,
    raw.created_at,
    raw.timestamp,
    raw.blockTimestamp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function transformTrades(payload: unknown): ProcessedTrade[] {
  const trades = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as RawTrade | undefined)?.data)
      ? ((payload as RawTrade).data as RawTrade[])
      : [];

  return trades
    .map((trade) => {
      if (typeof trade !== "object" || trade === null) {
        return undefined;
      }

      const rawTrade = trade as RawTrade;
      const idCandidate = rawTrade.id ?? rawTrade.tradeId ?? rawTrade.txid;
      if (typeof idCandidate !== "string" || idCandidate.length === 0) {
        return undefined;
      }

      const createdAt = extractCreatedAt(rawTrade);
      if (!createdAt) {
        return undefined;
      }

      const timestamp = Date.parse(createdAt);
      if (Number.isNaN(timestamp)) {
        return undefined;
      }

      const amount = parseAmount(rawTrade);

      return {
        id: idCandidate,
        marketTitle: extractMarketTitle(rawTrade),
        outcome: extractOutcome(rawTrade),
        amount,
        createdAt,
        timestamp,
        url: buildTradeUrl(rawTrade),
      } satisfies ProcessedTrade;
    })
    .filter((trade): trade is ProcessedTrade => Boolean(trade) && trade.amount > 799)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function buildTradeUrl(raw: RawTrade): string {
  const slug = extractSlug(raw);
  if (slug) {
    return `https://polymarket.com/event/${slug}`;
  }

  const transaction = raw.transactionHash || raw.txHash || raw.txid;
  if (typeof transaction === "string" && transaction.length > 0) {
    return `https://polygonscan.com/tx/${transaction}`;
  }

  return "https://polymarket.com";
}

function useTradeRecorder(trades: ProcessedTrade[]) {
  const ledgerRef = useRef<ProcessedTrade[]>([]);

  useEffect(() => {
    if (trades.length === 0) {
      return;
    }

    const knownIds = new Set(ledgerRef.current.map((trade) => trade.id));
    const additions = trades.filter((trade) => !knownIds.has(trade.id));

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
  const tradesRef = useRef<ProcessedTrade[]>([]);
  const lastUpdatedRef = useRef<number | null>(null);
  const persistenceDraftRef = useRef<ProcessedTrade[]>([]);

  const { prepareForPersist } = useTradeRecorder(trades);

  useEffect(() => {
    persistenceDraftRef.current = prepareForPersist();
  }, [prepareForPersist, trades]);

  useEffect(() => {
    let isActive = true;

    const load = async () => {
      try {
        const response = await fetch(POLYMARKET_ENDPOINT, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const json = await response.json();
        if (!isActive) {
          return;
        }

        const nextTrades = transformTrades(json);
        const previousTrades = tradesRef.current;
        const previousIds = new Set(previousTrades.map((trade) => trade.id));
        const mergedMap = new Map<string, ProcessedTrade>();
        const newTradeIds: string[] = [];

        nextTrades.forEach((trade) => {
          mergedMap.set(trade.id, trade);
          if (!previousIds.has(trade.id)) {
            newTradeIds.push(trade.id);
          }
        });

        previousTrades.forEach((trade) => {
          if (!mergedMap.has(trade.id)) {
            mergedMap.set(trade.id, trade);
          }
        });

        const mergedTrades = Array.from(mergedMap.values()).sort(
          (a, b) => b.timestamp - a.timestamp,
        );

        tradesRef.current = mergedTrades;
        lastUpdatedRef.current = Date.now();
        setTrades(mergedTrades);
        if (newTradeIds.length > 0) {
          setPulseIds(newTradeIds);
        }
        setConnection("connected");
      } catch {
        if (!isActive) {
          return;
        }
        setConnection("error");
      }
    };

    load();
    const interval = window.setInterval(load, 3000);

    return () => {
      isActive = false;
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

  const lastUpdated = lastUpdatedRef.current
    ? timeFormatter.format(lastUpdatedRef.current)
    : null;

  const statusText =
    connection === "connected"
      ? "Live — Polymarket trades streaming"
      : connection === "error"
        ? "Reconnecting…"
        : "Connecting to Polymarket…";

  return (
    <div className={`${styles.page} ${localStyles.page}`}>
      <header className={localStyles.hero}>
        <span className={localStyles.kicker}>Degen Terminal · Polymarket Edition</span>
        <h1 className={localStyles.title}>Feed</h1>
        <p className={localStyles.subtitle}>
          Real-time capture of whale trades over 799&nbsp;USDC across the prediction markets.
        </p>
      </header>

      <section className={localStyles.panel}>
        <div className={localStyles.statusRow}>
          <span className={`${localStyles.statusIndicator} ${localStyles[connection]}`} />
          <span className={localStyles.statusText}>{statusText}</span>
          {lastUpdated && connection === "connected" ? (
            <span className={localStyles.timestamp}>Updated {lastUpdated} UTC</span>
          ) : null}
        </div>

        <div className={localStyles.table}>
          <div className={`${localStyles.row} ${localStyles.headerRow}`}>
            <span>Market</span>
            <span className={localStyles.outcomeColumn}>Outcome</span>
            <span className={localStyles.amountColumn}>Amount</span>
            <span className={localStyles.timeColumn}>Time</span>
          </div>

          <div className={localStyles.body}>
            {trades.map((trade) => {
              const isNew = pulseIds.includes(trade.id);
              const isHuge = trade.amount >= 10_000;
              return (
                <Link
                  key={trade.id}
                  href={trade.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${localStyles.row} ${localStyles.tradeRow} ${
                    isHuge ? localStyles.hugeTrade : ""
                  } ${isNew ? localStyles.rowEnter : ""}`.trim()}
                >
                  <span className={localStyles.marketTitle}>{trade.marketTitle}</span>
                  <span className={localStyles.outcomeColumn}>{trade.outcome}</span>
                  <span className={localStyles.amountColumn}>{formatter.format(trade.amount)}</span>
                  <span className={localStyles.timeColumn}>{
                    timeFormatter.format(trade.timestamp)
                  }</span>
                </Link>
              );
            })}

            {connection === "connected" && trades.length === 0 ? (
              <div className={localStyles.emptyState}>
                No trades above 799&nbsp;USDC yet — standing by.
              </div>
            ) : null}

            {connection === "error" && trades.length === 0 ? (
              <div className={localStyles.emptyState}>Reconnecting…</div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
