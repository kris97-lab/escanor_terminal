"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import initialTradesSnapshot from "@/data/trades.json";

interface Trade {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  price: number;
  trader: string;
  createdAt: string;
}

interface Signal {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  trader: string;
  totalAmount: number;
  avgPrice: number;
  lastTrade: string;
}

interface PolymarketTrade {
  market_id?: string;
  market?: { question?: string | null } | null;
  outcome?: string | null;
  amount_usdc?: string | number | null;
  price?: string | number | null;
  fill_price?: string | number | null;
  avg_price?: string | number | null;
  maker?: string | null;
  created_at?: string | null;
}

interface PolymarketTradesResponse {
  trades?: PolymarketTrade[];
}

const LOCAL_STORAGE_KEY = "cachedTrades";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normaliseInitialSnapshot(snapshot: unknown): Trade[] {
  if (!Array.isArray(snapshot)) {
    return [];
  }

  return snapshot
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const {
        marketId,
        marketQuestion,
        outcome,
        amount,
        price,
        trader,
        createdAt,
      } = entry as Partial<Trade>;

      if (
        typeof marketId !== "string" ||
        typeof marketQuestion !== "string" ||
        typeof outcome !== "string" ||
        typeof trader !== "string" ||
        typeof createdAt !== "string" ||
        !isFiniteNumber(amount) ||
        !isFiniteNumber(price)
      ) {
        return null;
      }

      return {
        marketId,
        marketQuestion,
        outcome,
        amount,
        price,
        trader,
        createdAt,
      } satisfies Trade;
    })
    .filter((trade): trade is Trade => trade !== null);
}

const SNAPSHOT_TRADES: Trade[] = normaliseInitialSnapshot(initialTradesSnapshot);

export default function SignalsPage() {
  const [trades, setTrades] = useState<Trade[]>(SNAPSHOT_TRADES);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [status, setStatus] = useState("Connecting...");

  const fetchAndCacheTrades = useCallback(async () => {
    try {
      const res = await fetch("https://gamma-api.polymarket.com/trades?limit=200", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }

      const data = (await res.json()) as PolymarketTradesResponse;
      const rawTrades = Array.isArray(data.trades) ? data.trades : [];

      const parsed: Trade[] = rawTrades
        .map((raw) => {
          const marketId = raw.market_id ?? "";
          const marketQuestion = raw.market?.question ?? "Unknown market";
          const outcome = raw.outcome ?? "Unknown";
          const trader = raw.maker ?? "Unknown";
          const createdAt = raw.created_at ?? new Date().toISOString();
          const amount = Number(raw.amount_usdc ?? 0);
          const price = Number(raw.price ?? raw.fill_price ?? raw.avg_price ?? 0);

          if (
            !marketId ||
            !trader ||
            !Number.isFinite(amount) ||
            !Number.isFinite(price)
          ) {
            return null;
          }

          return {
            marketId,
            marketQuestion,
            outcome,
            amount,
            price,
            trader,
            createdAt,
          } satisfies Trade;
        })
        .filter((trade): trade is Trade => trade !== null);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
      }

      setTrades(parsed);
      setStatus("Connected ✅");
    } catch (error) {
      console.error("Signals fetch error", error);
      setStatus("Reconnecting...");
    }
  }, []);

  const loadCachedTrades = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const cached = window.localStorage.getItem(LOCAL_STORAGE_KEY);

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as unknown;
        const normalised = normaliseInitialSnapshot(parsed);
        if (normalised.length > 0) {
          setTrades(normalised);
          console.log(`Loaded cached trades: ${normalised.length}`);
          return;
        }
      } catch (error) {
        console.warn("Failed to parse cached trades", error);
      }
    }

    if (SNAPSHOT_TRADES.length > 0) {
      setTrades(SNAPSHOT_TRADES);
      console.log(`Loaded snapshot trades: ${SNAPSHOT_TRADES.length}`);
    }
  }, []);

  useEffect(() => {
    loadCachedTrades();
    fetchAndCacheTrades();
    const interval = setInterval(fetchAndCacheTrades, 15000);
    return () => clearInterval(interval);
  }, [fetchAndCacheTrades, loadCachedTrades]);

  const computedSignals = useMemo(() => {
    const grouped = new Map<string, Trade[]>();

    trades
      .filter((trade) => trade.amount >= 800 && trade.price < 0.6)
      .forEach((trade) => {
        const key = `${trade.trader}_${trade.marketId}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.push(trade);
        } else {
          grouped.set(key, [trade]);
        }
      });

    const result: Signal[] = [];

    grouped.forEach((group) => {
      if (group.length === 0) {
        return;
      }

      const totalAmount = group.reduce((sum, trade) => sum + trade.amount, 0);
      const avgPrice = group.reduce((sum, trade) => sum + trade.price, 0) / group.length;

      if (totalAmount <= 3000 || avgPrice >= 0.6) {
        return;
      }

      const sortedByTime = [...group].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const lastTrade = sortedByTime[sortedByTime.length - 1]?.createdAt ?? group[0].createdAt;
      const sample = sortedByTime[sortedByTime.length - 1] ?? group[0];

      result.push({
        marketId: sample.marketId,
        marketQuestion: sample.marketQuestion,
        outcome: sample.outcome,
        trader: sample.trader,
        totalAmount,
        avgPrice,
        lastTrade,
      });
    });

    return result.sort((a, b) => b.totalAmount - a.totalAmount);
  }, [trades]);

  useEffect(() => {
    setSignals(computedSignals);
  }, [computedSignals]);

  return (
    <div className="min-h-screen bg-black text-white font-mono p-6">
      <div className="flex items-center gap-2 mb-4">
        <div
          className={`h-3 w-3 rounded-full ${
            status.includes("Connected") ? "bg-green-400" : "bg-red-500"
          }`}
        ></div>
        <span className="text-sm text-gray-400">{status}</span>
      </div>

      <h1 className="text-2xl font-bold text-yellow-300 mb-6">
        SIGNALS (JSON Cache Mode) · POLYMARKET
      </h1>

      {signals.length === 0 && (
        <div className="text-gray-500 animate-pulse">No qualifying entries yet 💤</div>
      )}

      <div className="space-y-4">
        {signals.map((sig) => (
          <div
            key={`${sig.trader}-${sig.marketId}`}
            className="border border-yellow-400/40 bg-black/50 rounded-xl p-4 shadow-[0_0_10px_#fff35a40] hover:shadow-[0_0_20px_#fff35a80] transition-all duration-300"
          >
            <div className="text-lg text-yellow-300 font-semibold mb-1">
              {sig.marketQuestion}
            </div>
            <div className="text-sm mb-1">
              Outcome:{" "}
              <span className={sig.outcome === "Yes" ? "text-green-400" : "text-red-400"}>
                {sig.outcome}
              </span>
            </div>
            <div className="text-sm text-gray-300">
              Trader:{" "}
              <a
                href={`https://polymarket.com/profile/${sig.trader}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline hover:text-blue-300"
              >
                {sig.trader.slice(0, 6)}...{sig.trader.slice(-4)}
              </a>
            </div>
            <div className="text-sm text-gray-300">
              Total Buy: ${sig.totalAmount.toLocaleString()}
            </div>
            <div className="text-sm text-gray-300">
              Avg Price: {(sig.avgPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Last trade: {new Date(sig.lastTrade).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
