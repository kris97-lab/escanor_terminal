type RequestParams = Record<string, string | number | undefined | null>;

export type CoinIdMarketChartParams = {
  id: string;
  vs_currency: string;
  days: number | string;
  interval?: string;
  precision?: number | string;
};

export type CoinIdMarketChartResponse = {
  prices?: [number, number][];
  market_caps?: [number, number][];
  total_volumes?: [number, number][];
};

export type CoinGeckoClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";
const DEFAULT_TIMEOUT_MS = 12_000;

export class CoinGeckoClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CoinGeckoClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async coinIdMarketChart(
    params: CoinIdMarketChartParams,
  ): Promise<CoinIdMarketChartResponse> {
    const { id, vs_currency, days, interval, precision } = params;

    if (!id) {
      throw new Error("CoinGeckoClient.coinIdMarketChart requires an id");
    }

    if (!vs_currency) {
      throw new Error("CoinGeckoClient.coinIdMarketChart requires vs_currency");
    }

    if (days === undefined || days === null || days === ("" as unknown)) {
      throw new Error("CoinGeckoClient.coinIdMarketChart requires days");
    }

    return this.request<CoinIdMarketChartResponse>(
      `/coins/${encodeURIComponent(id)}/market_chart`,
      {
        vs_currency,
        days,
        interval,
        precision,
      },
    );
  }

  private async request<T>(path: string, params: RequestParams = {}): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "EscanorTerminal/1.0 (+https://farcaster.miniapp)",
    };

    if (this.apiKey) {
      headers["x-cg-pro-api-key"] = this.apiKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await CoinGeckoClient.safeReadBody(response);
        throw new Error(
          `CoinGecko responded with ${response.status}${message ? ` – ${message}` : ""}`,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("CoinGecko request timed out");
      }

      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  private static async safeReadBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, 200);
    } catch {
      return "";
    }
  }
}

export default CoinGeckoClient;
