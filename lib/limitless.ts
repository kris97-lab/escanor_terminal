const DEFAULT_HEADERS: HeadersInit = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    const message = text || response.statusText || "Unknown error";
    throw new Error(`Limitless API ${response.status}: ${message}`);
  }

  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Limitless API ${response.status}: Failed to parse JSON response. ${(error as Error).message}`,
    );
  }
}

export type LimitlessOrderSide = "BUY" | "SELL";

export interface LimitlessMarket {
  id: string;
  [key: string]: unknown;
}

export interface LimitlessTrade {
  id: string;
  marketId: string;
  outcome: string;
  amount: number;
  price?: number;
  trader?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PlaceOrderPayload {
  marketId: string;
  outcome: string;
  amount: number;
  side: LimitlessOrderSide;
  price?: number;
}

export interface LimitlessOrder {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface ClosePositionResponse {
  orderId: string;
  status: string;
  [key: string]: unknown;
}

export class LimitlessClient {
  private readonly baseHeaders: HeadersInit;

  constructor(private readonly baseUrl: string, headers: HeadersInit = {}) {
    this.baseHeaders = { ...DEFAULT_HEADERS, ...headers };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = buildUrl(this.baseUrl, path);
    const headers: HeadersInit = {
      ...this.baseHeaders,
      ...init.headers,
    };

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (error) {
      throw new Error(`Limitless API request failed: ${(error as Error).message}`);
    }

    return parseResponse<T>(response);
  }

  async getMarkets(): Promise<LimitlessMarket[]> {
    return this.request<LimitlessMarket[]>("/markets");
  }

  async getMarketById(id: string): Promise<LimitlessMarket> {
    if (!id) {
      throw new Error("Market id is required");
    }
    return this.request<LimitlessMarket>(`/markets/${encodeURIComponent(id)}`);
  }

  async getTrades(marketId: string, limit?: number): Promise<LimitlessTrade[]> {
    if (!marketId) {
      throw new Error("marketId is required to fetch trades");
    }

    const query = typeof limit === "number" ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return this.request<LimitlessTrade[]>(`/markets/${encodeURIComponent(marketId)}/trades${query}`);
  }

  async placeOrder(payload: PlaceOrderPayload): Promise<LimitlessOrder> {
    if (!payload.marketId || !payload.outcome || !payload.side) {
      throw new Error("marketId, outcome, and side are required to place an order");
    }

    if (!(payload.side === "BUY" || payload.side === "SELL")) {
      throw new Error("side must be either BUY or SELL");
    }

    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      throw new Error("amount must be a positive number");
    }

    return this.request<LimitlessOrder>("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async closePosition(orderId: string): Promise<ClosePositionResponse> {
    if (!orderId) {
      throw new Error("orderId is required to close a position");
    }

    return this.request<ClosePositionResponse>(`/orders/${encodeURIComponent(orderId)}/close`, {
      method: "POST",
    });
  }
}
