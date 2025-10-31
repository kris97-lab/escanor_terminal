const POLYMARKET_API_URL = "https://data-api.polymarket.com/trades";

export type PolymarketTrade = {
  id: string;
  ts: string;
  side: "BUY" | "SELL";
  amountUSD: number;
  price?: number;
  outcome?: string;
  market: string;
  marketId: string;
  maker?: string | null;
  url?: string | null;
  slug?: string | null;
};

type RawTrade = {
  transactionHash?: string | null;
  conditionId?: string | null;
  timestamp?: number | string | null;
  side?: string | null;
  price?: number | string | null;
  size?: number | string | null;
  amount?: number | string | null;
  amount_usdc?: number | string | null;
  outcome?: string | null;
  title?: string | null;
  asset?: string | null;
  slug?: string | null;
  eventSlug?: string | null;
  maker?: string | null;
};

function tsToIso(t: number | string | null | undefined): string {
  if (t === null || t === undefined) {
    return new Date().toISOString();
  }

  const numeric = typeof t === "string" ? Number(t) : t;
  if (!Number.isFinite(numeric)) {
    return new Date().toISOString();
  }

  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(ms).toISOString();
}

function parseNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchPolymarketTrades({
  limit = 150,
  minAmountUSD = 0,
  takerOnly = true,
  filterType = "CASH",
}: {
  limit?: number;
  minAmountUSD?: number;
  takerOnly?: boolean;
  filterType?: string;
} = {}): Promise<PolymarketTrade[]> {
  const url = new URL(POLYMARKET_API_URL);
  url.searchParams.set("limit", String(limit));
  if (takerOnly) {
    url.searchParams.set("takerOnly", "true");
  }
  if (filterType) {
    url.searchParams.set("filterType", filterType);
  }
  if (minAmountUSD > 0) {
    url.searchParams.set("filterAmount", String(minAmountUSD));
  }

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Polymarket API ${response.status}${text ? ` – ${text.slice(0, 120)}` : ""}`);
  }

  const json = (await response.json()) as RawTrade[] | { trades?: RawTrade[] } | null;
  const tradesArray = Array.isArray(json)
    ? json
    : Array.isArray(json?.trades)
    ? json?.trades ?? []
    : [];

  const normalised: PolymarketTrade[] = [];

  for (const trade of tradesArray) {
    const price = parseNumber(trade.price);
    const size = parseNumber(trade.size);
    const explicitAmount = parseNumber(trade.amount_usdc ?? trade.amount);
    const amount =
      explicitAmount !== null
        ? explicitAmount
        : price !== null && size !== null
        ? Math.round(price * size)
        : null;

    if (amount === null || !Number.isFinite(amount) || amount < minAmountUSD) {
      continue;
    }

    const id =
      (typeof trade.transactionHash === "string" && trade.transactionHash.length > 0 && trade.transactionHash) ||
      `${trade.conditionId ?? "market"}-${trade.timestamp ?? Date.now()}`;

    const side = typeof trade.side === "string" ? trade.side.toUpperCase() : "BUY";

    const marketId =
      (typeof trade.conditionId === "string" && trade.conditionId.length > 0 && trade.conditionId) ||
      (typeof trade.asset === "string" && trade.asset.length > 0 && trade.asset) ||
      (typeof trade.slug === "string" && trade.slug.length > 0 && trade.slug) ||
      (typeof trade.eventSlug === "string" && trade.eventSlug.length > 0 && trade.eventSlug) ||
      "unknown-market";

    const slug =
      (typeof trade.slug === "string" && trade.slug.length > 0 && trade.slug) ||
      (typeof trade.eventSlug === "string" && trade.eventSlug.length > 0 && trade.eventSlug) ||
      null;

    const url = slug ? `https://polymarket.com/market/${slug}` : null;

    const outcome = typeof trade.outcome === "string" && trade.outcome.length > 0 ? trade.outcome : undefined;
    const market =
      (typeof trade.title === "string" && trade.title.length > 0 && trade.title) ||
      (typeof trade.asset === "string" && trade.asset.length > 0 && trade.asset) ||
      "Unknown market";

    normalised.push({
      id,
      ts: tsToIso(trade.timestamp ?? null),
      side: side === "SELL" ? "SELL" : "BUY",
      amountUSD: amount,
      price: price ?? undefined,
      outcome,
      market,
      marketId,
      maker: typeof trade.maker === "string" ? trade.maker : null,
      url,
      slug,
    });
  }

  normalised.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
  return normalised;
}
