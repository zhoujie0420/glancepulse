import type {
  MarketItem,
  OrderSide,
  PortfolioSnapshot,
  PriceAlert,
  TradeOrder,
} from "../src/types.js";

export class GlanceLedger {
  private balanceUsd = 10_000;
  private realizedPnlUsd = 0;
  private orders: TradeOrder[] = [];
  private alerts: PriceAlert[] = [];
  private seq = 1;

  public placeOrder(market: MarketItem, side: OrderSide, notionalUsd: number): TradeOrder {
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || notionalUsd > 25_000) {
      throw new Error("notionalUsd must be between 1 and 25000");
    }
    if (market.source === "hyperliquid" && side !== "LONG" && side !== "SHORT") {
      throw new Error("Hyperliquid orders require LONG or SHORT");
    }
    if (market.source === "polymarket" && side !== "BUY_YES" && side !== "BUY_NO") {
      throw new Error("Polymarket orders require BUY_YES or BUY_NO");
    }
    if (notionalUsd > this.balanceUsd) {
      throw new Error("Insufficient paper margin balance");
    }

    const entryPrice =
      side === "BUY_NO" ? Math.max(0.001, 1 - market.price) : Math.max(0.0001, market.price);

    const order: TradeOrder = {
      id: `GP-${String(this.seq++).padStart(4, "0")}`,
      marketId: market.id,
      source: market.source,
      symbol: market.symbol,
      title: market.title,
      side,
      notionalUsd,
      entryPrice,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    this.balanceUsd -= notionalUsd;
    this.orders.unshift(order);
    return order;
  }

  public computePnl(order: TradeOrder, liveMarketPrice: number): number {
    if (order.source === "hyperliquid") {
      const pctMove = (liveMarketPrice - order.entryPrice) / order.entryPrice;
      const signed = order.side === "LONG" ? pctMove : -pctMove;
      return Number((order.notionalUsd * signed).toFixed(2));
    }
    // Polymarket binary shares: shares = notional / entryPrice; mark = yesProb (or 1-yesProb for NO)
    const markProb = order.side === "BUY_YES" ? liveMarketPrice : 1 - liveMarketPrice;
    const shares = order.notionalUsd / order.entryPrice;
    const valueNow = shares * markProb;
    return Number((valueNow - order.notionalUsd).toFixed(2));
  }

  public closeOrder(orderId: string, liveMarketPrice: number): TradeOrder {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== "OPEN") throw new Error(`Order ${orderId} is already closed`);

    const pnl = this.computePnl(order, liveMarketPrice);
    order.status = "CLOSED";
    order.closedAt = new Date().toISOString();
    order.exitPrice = order.side === "BUY_NO" ? 1 - liveMarketPrice : liveMarketPrice;
    order.realizedPnlUsd = pnl;
    this.realizedPnlUsd = Number((this.realizedPnlUsd + pnl).toFixed(2));
    this.balanceUsd = Number((this.balanceUsd + order.notionalUsd + pnl).toFixed(2));
    return order;
  }

  public createAlert(
    market: MarketItem,
    direction: "ABOVE" | "BELOW",
    targetPrice: number,
  ): PriceAlert {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      throw new Error("targetPrice must be positive");
    }
    const alert: PriceAlert = {
      id: `AL-${String(this.seq++).padStart(4, "0")}`,
      marketId: market.id,
      symbol: market.symbol,
      direction,
      targetPrice,
      triggered: false,
      createdAt: new Date().toISOString(),
    };
    this.alerts.unshift(alert);
    return alert;
  }

  public evaluate(markets: MarketItem[]): PortfolioSnapshot {
    const priceById = new Map<string, number>();
    for (const m of markets) priceById.set(m.id, m.price);

    let totalUnrealized = 0;
    const enrichedOrders = this.orders.map((o) => {
      if (o.status !== "OPEN") return o;
      const cur = priceById.get(o.marketId) ?? o.entryPrice;
      const pnl = this.computePnl(o, cur);
      totalUnrealized += pnl;
      return { ...o, currentPrice: cur, unrealizedPnlUsd: pnl };
    });

    for (const a of this.alerts) {
      if (a.triggered) continue;
      const cur = priceById.get(a.marketId);
      if (cur === undefined) continue;
      const hit =
        (a.direction === "ABOVE" && cur >= a.targetPrice) ||
        (a.direction === "BELOW" && cur <= a.targetPrice);
      if (hit) {
        a.triggered = true;
        a.triggeredAt = new Date().toISOString();
      }
    }

    return {
      balanceUsd: Number(this.balanceUsd.toFixed(2)),
      unrealizedPnlUsd: Number(totalUnrealized.toFixed(2)),
      realizedPnlUsd: Number(this.realizedPnlUsd.toFixed(2)),
      openCount: enrichedOrders.filter((o) => o.status === "OPEN").length,
      orders: enrichedOrders,
      alerts: this.alerts,
    };
  }
}
