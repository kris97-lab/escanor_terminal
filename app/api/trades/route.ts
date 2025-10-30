import { NextResponse } from "next/server";

type RawTrade = {
  transactionHash?: string;
  conditionId?: string;
  timestamp: number;
  side: string;
  price?: number;
  size?: number;
  outcome?: string;
  title?: string;
  asset?: string;
  slug?: string;
  eventSlug?: string;
};

type Trade = {
  id: string;
  ts: string;
  side: "BUY" | "SELL";
  amountUSD: number;
  price?: number;
  outcome?: string;
  market: string;
  url?: string;
};

function tsToIso(t: number): string {
  const ms = t > 10_000_000_000 ? t : t * 1000;
  return new Date(ms).toISOString();
}

async function fetchPolymarketTrades(minUSD = 800, limit = 150): Promise<Trade[]> {
  const u = new URL("https://data-api.polymarket.com/trades");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("takerOnly", "true");
  u.searchParams.set("filterType", "CASH");
  u.searchParams.set("filterAmount", String(minUSD));

  const r = await fetch(u.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Polymarket API ${r.status} – ${text.slice(0, 200)}`);
  }

  const raw = (await r.json()) as RawTrade[];

  const mapped: Trade[] = raw.map((x) => {
    const price = typeof x.price === "number" ? x.price : undefined;
    const size = typeof x.size === "number" ? x.size : 0;

    const notional = Math.round((price ?? 0) * size);

    let url: string | undefined = undefined;
    if (x.slug) url = `https://polymarket.com/market/${x.slug}`;
    else if (x.eventSlug) url = `https://polymarket.com/event/${x.eventSlug}`;

    return {
      id: x.transactionHash || `${x.conditionId || "cond"}-${x.timestamp}`,
      ts: tsToIso(Number(x.timestamp)),
      side: x.side.toUpperCase() === "BUY" ? "BUY" : "SELL",
      amountUSD: notional,
      price,
      outcome: x.outcome,
      market: x.title || x.asset || "Unknown market",
      url,
    };
  });

  mapped.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
  return mapped.filter((t) => t.amountUSD >= minUSD);
}

export async function GET() {
  try {
    const data = await fetchPolymarketTrades(800, 200);
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    throw e;
  }
}
