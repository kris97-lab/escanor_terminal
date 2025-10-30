"use client";

import { useEffect, useMemo, useState } from "react";

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
  potentialROI: number;
  lastTrade: string;
}

interface PolymarketTrade {
  market_id?: string;
  market?: { question?: string | null } | null;
  outcome?: string | null;
  amount_usdc?: string | number | null;
  price?: string | number | null;
  maker?: string | null;
  created_at?: string | null;
}

interface PolymarketTradesResponse {
  trades?: PolymarketTrade[];
}

function formatTrader(trader: string): string {
  if (trader.length <= 10) {
    return trader;
  }

  return `${trader.slice(0, 6)}...${trader.slice(-4)}`;
}

function calculatePotentialRoi(avgPrice: number): number {
  if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
    return 0;
  }

  return ((1 - avgPrice) / avgPrice) * 100;
}

export default function SignalsPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [status, setStatus] = useState("Connecting...");

  const fetchTrades = async () => {
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
        .map((t) => {
          const marketId = t.market_id ?? "";
          const marketQuestion = t.market?.question ?? "Unknown market";
          const outcome = t.outcome ?? "Unknown";
          const trader = t.maker ?? "Unknown";
          const createdAt = t.created_at ?? new Date().toISOString();
          const amount = Number(t.amount_usdc);
          const price = Number(t.price);

          if (!marketId || !trader || !Number.isFinite(amount) || !Number.isFinite(price)) {
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

      setTrades(parsed);
      setStatus("Connected ✅");
    } catch (err) {
      console.error("Profit detector fetch error", err);
      setStatus("Reconnecting...");
    }
  };

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, []);

  const computedSignals = useMemo(() => {
    const grouped = new Map<string, Trade[]>();

    trades.forEach((trade) => {
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

      const sortedByTime = [...group].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const lastTrade = sortedByTime[sortedByTime.length - 1]?.createdAt ?? group[0].createdAt;
      const sample = sortedByTime[sortedByTime.length - 1] ?? group[0];

      result.push({
        marketId: sample.marketId,
        marketQuestion: sample.marketQuestion,
        outcome: sample.outcome,
        trader: sample.trader,
        totalAmount,
        avgPrice,
        potentialROI: calculatePotentialRoi(avgPrice),
        lastTrade,
      });
    });

    return result
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 20);
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
        PROFIT POTENTIAL DETECTOR · POLYMARKET
      </h1>

      {signals.length === 0 && (
        <div className="text-gray-500 animate-pulse">
          No profit-potential entries found 💤
        </div>
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
              <span
                className={sig.outcome === "Yes" ? "text-green-400" : "text-red-400"}
              >
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
                {formatTrader(sig.trader)}
              </a>
            </div>
            <div className="text-sm text-gray-300">
              Total Buy: ${sig.totalAmount.toLocaleString()}
            </div>
            <div className="text-sm text-gray-300">
              Avg Entry Price: {(sig.avgPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-sm text-green-400">
              Potential ROI: +{sig.potentialROI.toFixed(0)}%
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
