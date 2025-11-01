import { NextResponse } from "next/server";

const PYTH_URL =
  "https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

const LIMITLESS_URL =
  "https://api.limitless.exchange/markets/btc-usd-hourly-prediction/historical-price?interval=1h";

type PythPayload =
  | Array<{
      price?: {
        price?: number | string;
        expo?: number | string;
        publish_time?: number | string;
      };
    }>
  | undefined;

type LimitlessPayload =
  | Array<{
      prices?: Array<{
        timestamp?: number | string;
        price?: number | string;
        marketPrice?: number | string;
        value?: number | string;
      }>;
    }>
  | {
      prices?: Array<{
        timestamp?: number | string;
        price?: number | string;
        marketPrice?: number | string;
        value?: number | string;
      }>;
    }
  | undefined;

function parsePythPrice(payload: PythPayload) {
  const feed = Array.isArray(payload) ? payload[0] : undefined;
  const rawPrice = Number(feed?.price?.price);
  const expo = Number(feed?.price?.expo);
  const publishTime = Number(feed?.price?.publish_time);

  if (!Number.isFinite(rawPrice) || !Number.isFinite(expo) || !Number.isFinite(publishTime)) {
    throw new Error("Invalid Pyth payload");
  }

  const price = rawPrice * Math.pow(10, expo);
  const timestamp = publishTime * 1000;

  if (!Number.isFinite(price) || !Number.isFinite(timestamp)) {
    throw new Error("Invalid Pyth payload");
  }

  return { price, timestamp } as const;
}

function parseLimitlessPrices(payload: LimitlessPayload) {
  const containerArray = Array.isArray(payload) ? payload : payload ? [payload] : [];

  const points: Array<{ timestamp: number; marketPrice: number }> = [];

  for (const container of containerArray) {
    const series = Array.isArray(container?.prices) ? container?.prices ?? [] : [];

    for (const entry of series) {
      const rawTimestamp =
        typeof entry?.timestamp === "number"
          ? entry.timestamp
          : typeof entry?.timestamp === "string"
          ? Number(entry.timestamp)
          : Number.NaN;

      const fallbackTimestamp =
        typeof entry?.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;

      const timestamp = Number.isFinite(rawTimestamp)
        ? rawTimestamp
        : Number.isFinite(fallbackTimestamp)
        ? fallbackTimestamp
        : Number.NaN;

      const basePrice =
        typeof entry?.marketPrice === "number"
          ? entry.marketPrice
          : typeof entry?.price === "number"
          ? entry.price
          : typeof entry?.value === "number"
          ? entry.value
          : Number(entry?.marketPrice ?? entry?.price ?? entry?.value);

      const numericPrice = Number.isFinite(basePrice) ? Number(basePrice) : Number.NaN;

      if (!Number.isFinite(timestamp) || !Number.isFinite(numericPrice)) {
        continue;
      }

      const marketPrice = numericPrice < 10 ? numericPrice * 100 : numericPrice;
      const normalisedTimestamp = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;

      points.push({ timestamp: normalisedTimestamp, marketPrice });
    }
  }

  return points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.marketPrice))
    .map((point) => ({
      timestamp: Math.trunc(point.timestamp),
      marketPrice: Number(point.marketPrice),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function GET() {
  try {
    const [pythResult, limitlessResult] = await Promise.allSettled([
      fetch(PYTH_URL, { cache: "no-store" }),
      fetch(LIMITLESS_URL, {
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "EscanorTerminal/1.0 (Next.js)",
        },
      }),
    ]);

    if (pythResult.status !== "fulfilled") {
      throw pythResult.reason ?? new Error("Unable to reach Pyth oracle");
    }

    const pythResponse = pythResult.value;
    if (!pythResponse.ok) {
      throw new Error(`Pyth API ${pythResponse.status}`);
    }

    const pythJson = (await pythResponse.json()) as PythPayload;
    const pyth = parsePythPrice(pythJson);

    let limitless: Array<{ timestamp: number; marketPrice: number }> = [];

    if (limitlessResult.status === "fulfilled") {
      const limitlessResponse = limitlessResult.value;

      if (limitlessResponse.ok) {
        try {
          const limitlessJson = (await limitlessResponse.json()) as LimitlessPayload;
          limitless = parseLimitlessPrices(limitlessJson);
        } catch (err) {
          console.error("Failed to parse Limitless prices", err);
        }
      } else {
        console.warn(`Limitless API ${limitlessResponse.status}`);
      }
    } else {
      console.warn("Limitless fetch failed", limitlessResult.reason);
    }

    return NextResponse.json({ pyth, limitless });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown oracle error";
    console.error("Oracle fetch error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
