export type PricePoint = {
  timestamp: number;
  price: number;
};

export type PositionSnapshot = {
  direction: "up" | "down";
  statement: string;
  pnlPercent: number;
  investment: number;
  currentValue: number;
  payout: number;
};

export type MarketSnapshot = {
  slug: string;
  title: string;
  baseline: number;
  strike: number;
  priceHistory: PricePoint[];
  currentPrice: number;
  expirationTimestamp: number | null;
  aboveMultiplier: number;
  belowMultiplier: number;
  source: "limitless" | "coingecko" | "mock";
  fallback: boolean;
  lastUpdated: number;
  position: PositionSnapshot;
};
