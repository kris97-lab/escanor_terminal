import { NextResponse } from "next/server";

const BTC_FEED_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const ENDPOINT = `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${BTC_FEED_ID}`;

export async function GET() {
  try {
    const res = await fetch(ENDPOINT, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Pyth API ${res.status}`);
    }

    const data = (await res.json()) as Array<{
      price: { price: number; expo: number; publish_time: number };
    }>;

    const feed = data[0];
    if (!feed || !feed.price) {
      throw new Error("Pyth price feed unavailable");
    }

    const { price, expo, publish_time: publishTime } = feed.price;
    const normalisedPrice = Number(price) * 10 ** Number(expo);
    const timestamp = Number(publishTime) * 1000;

    if (!Number.isFinite(normalisedPrice) || !Number.isFinite(timestamp)) {
      throw new Error("Invalid price payload from Pyth");
    }

    return NextResponse.json({ price: normalisedPrice, timestamp });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PYTH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
