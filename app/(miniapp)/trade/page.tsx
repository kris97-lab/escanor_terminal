"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface ApiPricePoint {
  timestamp: number | string;
  price: number | string;
}

interface ApiResponse {
  prices?: ApiPricePoint[];
  strike?: number | string | null;
}

type ChartPoint = {
  [key: string]: string | number;
  time: string;
  price: number;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatTimestampLabel(timestamp: number | string): string {
  const numeric = toNumber(timestamp);
  if (numeric === null) {
    return "";
  }

  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ETHLiveChart() {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [price, setPrice] = useState(0);
  const [strike, setStrike] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/limitless/eth");
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const json = (await res.json()) as ApiResponse;
      const rawPrices = json.prices ?? [];

      const formatted = rawPrices
        .map((entry) => {
          const numericPrice = toNumber(entry.price);
          const numericTimestamp = toNumber(entry.timestamp);

          if (numericPrice === null || numericTimestamp === null) {
            return null;
          }

          return {
            time: formatTimestampLabel(numericTimestamp),
            price: numericPrice,
          } satisfies ChartPoint;
        })
        .filter((point): point is ChartPoint => point !== null);

      if (formatted.length === 0) {
        throw new Error("No data");
      }

      const latest = formatted.at(-1);
      setData(formatted);
      setPrice(latest?.price ?? 0);
      setStrike(toNumber(json.strike ?? null));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("ETH live chart fetch error:", message);
      setError(message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = window.setInterval(fetchData, 3_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="text-center text-yellow-300 p-6">
      <h2 className="font-bold text-xl mb-2">ETH Live (Limitless)</h2>
      {error ? (
        <div className="text-red-500">Error: {error}</div>
      ) : (
        <>
          <div className="text-4xl font-mono mb-1">
            ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          {strike !== null && (
            <div className="text-red-400 text-sm mb-2">Strike: ${strike}</div>
          )}
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <XAxis dataKey="time" stroke="#777" />
                <YAxis stroke="#777" />
                <Tooltip
                  contentStyle={{
                    background: "#111",
                    border: "1px solid #333",
                    color: "#fff",
                  }}
                />
                {strike !== null && (
                  <ReferenceLine
                    y={strike}
                    stroke="#FF4444"
                    strokeDasharray="5 5"
                    label={{ value: "Strike ↑", fill: "#FF7777", position: "right" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#00FFAA"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
