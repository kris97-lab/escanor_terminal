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

type ApiPricePoint = {
  timestamp: number;
  price: number;
};

type ApiResponse = {
  strike: number | null;
  prices?: ApiPricePoint[];
};

type ChartDatum = {
  time: string;
  price: number;
};

export default function ETHLiveChart() {
  const [data, setData] = useState<ChartDatum[]>([]);
  const [price, setPrice] = useState(0);
  const [strike, setStrike] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/limitless/eth");
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const json: ApiResponse = await res.json();
      if (!Array.isArray(json.prices)) {
        throw new Error("No data");
      }

      const formatted: ChartDatum[] = json.prices.map((point) => ({
        time: new Date(point.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        price: Number(point.price),
      }));

      const latestPrice = formatted.at(-1)?.price ?? 0;

      setData(formatted);
      setPrice(latestPrice);
      setStrike(json.strike ?? null);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(err);
      setError(message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3_000);
    return () => clearInterval(interval);
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
            <ResponsiveContainer>
              <LineChart data={data}>
                <XAxis dataKey="time" tick={{ fill: "#777" }} />
                <YAxis tick={{ fill: "#777" }} domain={["auto", "auto"]} />
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
