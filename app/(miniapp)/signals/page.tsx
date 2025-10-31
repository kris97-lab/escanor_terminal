"use client";

import { useEffect, useState } from "react";

interface TradeSummary {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  amount: number;
  marketSlug: string | null;
}

interface SignalGroup {
  market: string;
  outcome: string;
  count: number;
  total: number;
  profileUrl: string;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<SignalGroup[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isMounted = true;

    const fetchSignals = async () => {
      try {
        const res = await fetch("/api/polymarket/trades");
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || `Status ${res.status}`);
        }

        const trades = (await res.json()) as unknown;

        if (!Array.isArray(trades)) {
          const fallbackError =
            typeof trades === "object" && trades !== null && "error" in trades
              ? String((trades as { error: unknown }).error)
              : "Bad data";
          throw new Error(fallbackError);
        }

        const parsedTrades = trades
          .map((trade) => {
            if (typeof trade !== "object" || trade === null) {
              return null;
            }

            const { id, marketId, marketQuestion, outcome, amount, marketSlug } =
              trade as Partial<TradeSummary>;

            if (
              typeof id !== "string" ||
              typeof marketId !== "string" ||
              typeof marketQuestion !== "string" ||
              typeof outcome !== "string" ||
              typeof amount !== "number"
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
            } satisfies TradeSummary;
          })
          .filter((trade): trade is TradeSummary => trade !== null);

        const grouped = new Map<string, { market: string; outcome: string; trades: TradeSummary[] }>();

        parsedTrades.forEach((trade) => {
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

        const insiderMarkets = Array.from(grouped.values())
          .filter((group) => group.trades.length >= 2)
          .map((group) => {
            const total = group.trades.reduce((sum, trade) => sum + trade.amount, 0);
            const profileUrlBase = group.trades[0]?.marketSlug ?? null;
            const profileUrl = profileUrlBase
              ? `https://polymarket.com/market/${profileUrlBase}`
              : "https://polymarket.com/markets";

            return {
              market: group.market,
              outcome: group.outcome,
              count: group.trades.length,
              total,
              profileUrl,
            } satisfies SignalGroup;
          })
          .sort((a, b) => b.total - a.total);

        if (isMounted) {
          setSignals(insiderMarkets);
          setError("");
        }
      } catch (err: unknown) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : "Unknown error";
          setError(message);
          setSignals([]);
        }
      }
    };

    fetchSignals();
    const timer = window.setInterval(fetchSignals, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="p-6 text-center text-white bg-black min-h-screen font-mono">
      <h2 className="text-lg font-bold text-yellow-300 mb-2">POLYMARKET ALPHA RADAR</h2>
      {error && (
        <div className="text-red-400 text-sm mb-3">Failed to load: {error}</div>
      )}
      {signals.length === 0 && !error ? (
        <div className="text-gray-400 text-sm">No qualifying entries yet 💤</div>
      ) : null}
      {signals.length > 0 ? (
        <div className="flex flex-col items-center gap-3 mt-4">
          {signals.map((signal) => (
            <a
              key={`${signal.market}-${signal.outcome}`}
              href={signal.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full max-w-md border border-yellow-300/20 bg-black/40 rounded-xl p-3 hover:border-yellow-400 transition"
            >
              <div className="text-yellow-300 font-bold text-sm mb-1">{signal.market}</div>
              <div className="text-gray-300 text-xs">
                Outcome: <span className="text-yellow-200">{signal.outcome}</span>
              </div>
              <div className="text-xs text-gray-400">
                Trades: {signal.count} • Total: ${signal.total.toLocaleString()}
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
