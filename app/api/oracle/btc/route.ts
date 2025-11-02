import { NextResponse } from "next/server";

const PYTH_FEED_ID =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

const PYTH_URL = (() => {
  const url = new URL("https://hermes.pyth.network/api/latest_price_feeds");
  url.searchParams.set("ids[]", PYTH_FEED_ID);
  url.searchParams.set("decoded", "true");
  return url.toString();
})();

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

type ParsedNumeric = {
  mantissa: number;
  exponentAdjustment: number;
};

function normaliseNumeric(value: unknown): ParsedNumeric | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { mantissa: value, exponentAdjustment: 0 };
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/e/i.test(trimmed)) {
    const scientific = Number(trimmed);
    if (!Number.isFinite(scientific)) {
      return null;
    }
    return { mantissa: scientific, exponentAdjustment: 0 };
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart, fractionalPart = ""] = unsigned.split(".");

  if (!/^[0-9]*$/.test(integerPart) || !/^[0-9]*$/.test(fractionalPart)) {
    return null;
  }

  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, "") || "0";
  const mantissa = Number.parseInt(digits, 10);

  if (!Number.isFinite(mantissa)) {
    return null;
  }

  const signedMantissa = negative ? -mantissa : mantissa;
  const exponentAdjustment = -fractionalPart.length;
  return { mantissa: signedMantissa, exponentAdjustment };
}

function scaleMantissa(mantissa: number, exponent: number): number {
  return mantissa * Math.pow(10, exponent);
}

function parsePythPrice(payload: PythPayload) {
  const feed = Array.isArray(payload) ? payload[0] : undefined;
  const priceInfo = feed?.price as
    | {
        price?: number | string;
        expo?: number | string;
        publish_time?: number | string;
        publishTime?: number | string;
      }
    | undefined;

  const numeric = normaliseNumeric(priceInfo?.price);
  const expo = Number(priceInfo?.expo);
  const publishTime = Number(priceInfo?.publish_time ?? priceInfo?.publishTime);

  if (!numeric || !Number.isFinite(expo) || !Number.isFinite(publishTime)) {
    throw new Error("Invalid Pyth payload");
  }

  const totalExponent = expo + numeric.exponentAdjustment;
  const price = scaleMantissa(numeric.mantissa, totalExponent);
  const timestamp = publishTime * 1000;

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) {
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
      fetch(PYTH_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
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
