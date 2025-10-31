import { NextResponse } from "next/server";

type CoinGeckoPriceEntry = [number, number];

type CoinGeckoResponse = {
  prices?: CoinGeckoPriceEntry[];
};

type NormalisedPricePoint = {
  timestamp: number;
  time: string;
  price: number;
};

export async function GET() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly",
      { cache: "no-store" },
    );

    if (!res.ok) {
      throw new Error(`CoinGecko returned ${res.status}`);
    }

    const data = (await res.json()) as CoinGeckoResponse;
    const entries = Array.isArray(data.prices) ? data.prices : [];

    const prices = entries
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) {
          return null;
        }

        const [timestampRaw, priceRaw] = entry;
        const timestamp = Number(timestampRaw);
        const price = Number(priceRaw);

        if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
          return null;
        }

        const adjustedTimestamp =
          timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
        const date = new Date(adjustedTimestamp);

        return {
          timestamp: adjustedTimestamp,
          time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          price,
        } satisfies NormalisedPricePoint;
      })
      .filter((point): point is NormalisedPricePoint => point !== null);

    if (prices.length === 0) {
      throw new Error("CoinGecko response missing price data");
    }

    return NextResponse.json({ prices }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("BTC API error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
