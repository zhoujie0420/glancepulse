export type MarketSource = "hyperliquid" | "polymarket";

export interface MarketItem {
  id: string;
  source: MarketSource;
  symbol: string;
  title: string;
  /** For hyperliquid: USD mark price; for polymarket: YES probability 0..1 */
  price: number;
  /** Formatted glanceable price string (e.g. "$58,042" or "47.5% YES") */
  priceDisplay: string;
  /** Secondary glance metric (e.g. "+1.4% | FR +0.01%" or "Vol $3.1M") */
  metaDisplay: string;
  change24hPct?: number;
  fundingRatePct?: number;
  volume24hUsd?: number;
  updatedAt: string;
}

export type OrderSide = "LONG" | "SHORT" | "BUY_YES" | "BUY_NO";

export interface TradeOrder {
  id: string;
  marketId: string;
  source: MarketSource;
  symbol: string;
  title: string;
  side: OrderSide;
  notionalUsd: number;
  entryPrice: number;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  closedAt?: string;
  exitPrice?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
  currentPrice?: number;
}

export interface PriceAlert {
  id: string;
  marketId: string;
  symbol: string;
  direction: "ABOVE" | "BELOW";
  targetPrice: number;
  triggered: boolean;
  createdAt: string;
  triggeredAt?: string;
}

export interface PortfolioSnapshot {
  balanceUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  openCount: number;
  orders: TradeOrder[];
  alerts: PriceAlert[];
}
