import { NextResponse } from "next/server";

const POLYMARKET_TRADES_URL = "https://gamma-api.polymarket.com/trades?limit=100";

type RawTrade = Record<string, unknown>;

type StructuredTrade = {
  marketId: string | null;
  marketSlug: string | null;
  marketQuestion: string;
  outcome: string;
  amount: number;
  trader: string | null;
  createdAt: string;
  tradeId: string;
  transactionHash: string | null;
};

function parseAmount(raw: RawTrade): number {
  const candidate = raw.amount_usdc ?? raw.amount ?? raw.value ?? raw.usdcAmount;
  if (typeof candidate === "number") {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function parseTrade(raw: RawTrade): StructuredTrade | null {
  const tradeId = coerceString(raw.id) ?? coerceString(raw.trade_id) ?? coerceString(raw.txid);
  if (!tradeId) {
    return null;
  }

  const createdAt =
    coerceString(raw.created_at) ??
    coerceString(raw.createdAt) ??
    coerceString(raw.timestamp) ??
    coerceString(raw.blockTimestamp);

  if (!createdAt) {
    return null;
  }

  const amount = parseAmount(raw);
  if (Number.isNaN(amount) || amount <= 799) {
    return null;
  }

  const market = (raw.market as RawTrade | undefined) ?? undefined;
  const question =
    coerceString(raw.marketQuestion) ??
    coerceString(raw.marketTitle) ??
    coerceString(raw.question) ??
    coerceString(raw.title) ??
    (market ? coerceString(market.question) ?? coerceString(market.title) ?? coerceString(market.name) : null);

  const slugSources = [
    market ? coerceString(market.slug) : null,
    coerceString(raw.marketSlug),
    coerceString(raw.market_slug),
    market ? coerceString(market.url) : null,
    coerceString(raw.marketUrl),
  ];

  const marketSlug = resolveSlug(slugSources);

  const outcome =
    coerceString(raw.outcome) ??
    coerceString(raw.outcomeName) ??
    coerceString(raw.tokenOutcome) ??
    coerceString(raw.marketOutcome) ??
    "Unknown";

  return {
    tradeId,
    createdAt,
    amount,
    marketId: coerceString(raw.marketId) ?? coerceString(raw.market_id) ?? null,
    marketSlug,
    marketQuestion: question ?? "Untitled Market",
    outcome,
    trader:
      coerceString(raw.maker_address) ??
      coerceString(raw.trader) ??
      coerceString(raw.maker) ??
      coerceString(raw.account) ??
      null,
    transactionHash:
      coerceString(raw.transactionHash) ??
      coerceString(raw.txHash) ??
      coerceString(raw.txid) ??
      null,
  };
}

export async function GET() {
  try {
    const response = await fetch(POLYMARKET_TRADES_URL, {
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      const errorPayload = await safeParse(response);
      return NextResponse.json(
        { error: "Upstream request failed", details: errorPayload },
        {
          status: response.status,
          headers: corsHeaders(),
        },
      );
    }

    const payload = await response.json();
    const trades = normalizeTrades(payload);

    return NextResponse.json(
      { trades },
      {
        headers: corsHeaders(),
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to reach Polymarket", details: error instanceof Error ? error.message : String(error) },
      {
        status: 502,
        headers: corsHeaders(),
      },
    );
  }
}

function normalizeTrades(payload: unknown): StructuredTrade[] {
  const trades = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as RawTrade | undefined)?.data)
      ? ((payload as RawTrade).data as RawTrade[])
      : [];

  return trades
    .map((entry) => (typeof entry === "object" && entry !== null ? parseTrade(entry as RawTrade) : null))
    .filter((trade): trade is StructuredTrade => trade !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 100);
}

async function safeParse(response: Response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } satisfies Record<string, string>;
}

function resolveSlug(candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.startsWith("http")) {
      try {
        const url = new URL(candidate);
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length > 0) {
          return segments[segments.length - 1];
        }
      } catch {
        continue;
      }
    } else {
      return candidate;
    }
  }

  return null;
}

export async function OPTIONS() {
  return NextResponse.json(null, { headers: corsHeaders() });
}
