"use client";

import { useEffect, useMemo, useState } from "react";

interface Trade {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  trader: string;
  createdAt: string;
}

interface Market {
  id: string;
  question: string;
  probability: number;
}

interface MarketsResponse {
  markets?: MarketEntry[];
}

interface MarketEntry {
  id: string;
  question: string;
  probability?: number | string | null;
}

interface Signal {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  trader: string;
  totalAmount: number;
  probability: number;
  lastTrade: string;
}

export default function SignalsPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [markets, setMarkets] = useState<Record<string, Market>>({});
  const [signals, setSignals] = useState<Signal[]>([]);
  const [status, setStatus] = useState("Connecting...");

  // Fetch trades from API
  const fetchTrades = async () => {
    try {
      const res = await fetch("/api/trades");
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const payload: Trade[] = Array.isArray(data)
        ? data
        : Array.isArray((data as { trades?: Trade[] }).trades)
          ? ((data as { trades?: Trade[] }).trades as Trade[])
          : [];
      setTrades(payload);
      setStatus("Connected ✅");
    } catch (err) {
      console.error(err);
      setStatus("Reconnecting...");
    }
  };

  // Fetch markets to get probability (to detect unresolved markets)
  const fetchMarkets = async () => {
    try {
      const res = await fetch("https://gamma-api.polymarket.com/markets");
      if (!res.ok) throw new Error("Markets API error");
      const data = (await res.json()) as MarketsResponse;
      const map: Record<string, Market> = {};
      data.markets?.forEach((market) => {
        if (!market?.id) {
          return;
        }

        const probability = Number(market.probability);
        map[market.id] = {
          id: market.id,
          question: market.question ?? "Unknown market",
          probability: Number.isFinite(probability) ? probability : 0.5,
        };
      });
      setMarkets(map);
    } catch (err) {
      console.error("Markets error", err);
    }
  };

  useEffect(() => {
    fetchTrades();
    fetchMarkets();
    const interval = setInterval(fetchTrades, 10000);
    return () => clearInterval(interval);
  }, []);

  // Compute signals
  const computedSignals = useMemo(() => {
    const grouped: Record<string, Trade[]> = {};

    trades
      .filter((t) => t.amount >= 800)
      .forEach((t) => {
        const key = `${t.trader}_${t.marketId}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(t);
      });

    const result: Signal[] = [];
    for (const group of Object.values(grouped)) {
      const trader = group[0].trader;
      const marketId = group[0].marketId;
      const totalAmount = group.reduce((a, b) => a + b.amount, 0);
      const lastTrade = group[group.length - 1].createdAt;
      const marketData = markets[marketId];
      if (!marketData) continue;
      const prob = marketData.probability;

      // Filter markets that still have real upside
      if (prob > 0.65 || prob < 0.35) continue;
      if (totalAmount < 2000) continue;

      result.push({
        marketId,
        marketQuestion: marketData.question,
        outcome: group[0].outcome,
        trader,
        totalAmount,
        probability: prob,
        lastTrade,
      });
    }

    return result.sort((a, b) => b.totalAmount - a.totalAmount);
  }, [trades, markets]);

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
        SMART SIGNALS · POLYMARKET ALPHA RADAR
      </h1>

      {signals.length === 0 && (
        <div className="text-gray-500 animate-pulse">
          No strategic entries detected 💤
        </div>
      )}

      <div className="space-y-4">
        {signals.map((sig, idx) => (
          <div
            key={idx}
            className="border border-yellow-400/40 bg-black/50 rounded-xl p-4 shadow-[0_0_10px_#fff35a40] hover:shadow-[0_0_20px_#fff35a80] transition-all duration-300"
          >
            <div className="text-lg text-yellow-300 font-semibold mb-1">
              {sig.marketQuestion}
            </div>
            <div className="text-sm mb-1">
              Outcome:{" "}
              <span
                className={
                  sig.outcome === "Yes" ? "text-green-400" : "text-red-400"
                }
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
                {sig.trader.slice(0, 6)}...{sig.trader.slice(-4)}
              </a>
            </div>
            <div className="text-sm text-gray-300">
              Total Buy: ${sig.totalAmount.toLocaleString()}
            </div>
            <div className="text-sm text-gray-400">
              Prob: {(sig.probability * 100).toFixed(1)}%
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
