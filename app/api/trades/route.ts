import { NextResponse } from "next/server";

const POLYMARKET_TRADES_URL = "https://gamma-api.polymarket.com/trades?limit=100";
const REQUEST_TIMEOUT_MS = 10_000;

type RawTrade = Record<string, unknown>;

type NormalizedTrade = {
  marketId: string | null;
  marketQuestion: string;
  outcome: string;
  amount: number;
  trader: string | null;
  createdAt: string;
  tradeId: string;
};

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(POLYMARKET_TRADES_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "EscanorTerminalBot/1.0 (+https://polymarket.com)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await safeParse(response);
      return NextResponse.json(
        {
          error: "Upstream request failed",
          status: response.status,
          details: errorBody ?? null,
        },
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
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("The operation was aborted") ? 504 : 502;

    return NextResponse.json(
      {
        error: "Unable to reach Polymarket",
        details: message,
      },
      {
        status,
        headers: corsHeaders(),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function OPTIONS() {
  return NextResponse.json(null, {
    headers: corsHeaders(),
  });
}

function normalizeTrades(payload: unknown): NormalizedTrade[] {
  const rawTrades = extractTrades(payload);

  return rawTrades
    .map((entry) => (typeof entry === "object" && entry !== null ? shapeTrade(entry as RawTrade) : null))
    .filter((trade): trade is NormalizedTrade => trade !== null && trade.amount > 799)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 100);
}

function extractTrades(payload: unknown): RawTrade[] {
  if (Array.isArray(payload)) {
    return payload as RawTrade[];
  }

  if (payload && typeof payload === "object") {
    if (Array.isArray((payload as RawTrade).trades)) {
      return (payload as { trades: RawTrade[] }).trades;
    }

    if (Array.isArray((payload as RawTrade).data)) {
      return (payload as { data: RawTrade[] }).data;
    }
  }

  return [];
}

function shapeTrade(raw: RawTrade): NormalizedTrade | null {
  const tradeId = coerceString(raw.id) ?? coerceString(raw.trade_id) ?? coerceString(raw.txid);
  if (!tradeId) {
    return null;
  }

  const createdAt =
    coerceDate(raw.created_at) ??
    coerceDate(raw.createdAt) ??
    coerceDate(raw.timestamp) ??
    coerceDate(raw.blockTimestamp) ??
    coerceDate(raw.block_time) ??
    coerceDate(raw.time);
  if (!createdAt) {
    return null;
  }

  const amount =
    coerceNumber(
      raw.amount_usdc ??
        raw.usdc_amount ??
        raw.amount ??
        raw.value ??
        raw.total ??
        raw.total_cost ??
        raw.notional ??
        raw.tradeSize ??
        raw.size,
    ) ?? coerceAmountFromPrice(raw);
  if (amount === null || !Number.isFinite(amount)) {
    return null;
  }

  const market = typeof raw.market === "object" && raw.market !== null ? (raw.market as RawTrade) : undefined;

  const marketQuestion =
    coerceString(raw.marketQuestion) ??
    coerceString(raw.marketTitle) ??
    coerceString(raw.question) ??
    (market ? coerceString(market.question) ?? coerceString(market.title) ?? coerceString(market.name) : null) ??
    "Untitled Market";

  const marketId =
    coerceString(raw.marketId) ??
    coerceString(raw.market_id) ??
    (market ? coerceString(market.id) ?? coerceString(market.market_id) : null) ??
    null;

  const outcome =
    coerceString(raw.outcome) ??
    coerceString(raw.outcomeName) ??
    coerceString(raw.tokenOutcome) ??
    coerceString(raw.marketOutcome) ??
    "Unknown";

  const trader =
    coerceString(raw.maker) ??
    coerceString(raw.trader) ??
    coerceString(raw.maker_address) ??
    coerceString(raw.taker) ??
    coerceString(raw.account) ??
    null;

  return {
    tradeId,
    createdAt,
    amount,
    outcome,
    marketId,
    marketQuestion,
    trader,
  };
}

function coerceAmountFromPrice(raw: RawTrade): number | null {
  const price = coerceNumber(raw.price ?? raw.execution_price);
  const quantity = coerceNumber(raw.quantity ?? raw.shares ?? raw.amount_shares);

  if (price !== null && quantity !== null) {
    return price * quantity;
  }

  return null;
}

async function safeParse(response: Response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return null;
}

function coerceDate(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 10_000_000_000 ? value : value * 1000;
    return new Date(timestamp).toISOString();
  }

  return null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } satisfies Record<string, string>;
}
