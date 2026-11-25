import { describe, expect, it } from "vitest";
import { normalizeHyperliquid, normalizePolymarket } from "../server/marketData.js";
import { GlanceLedger } from "../server/ledger.js";
import { buildG2Page, validateG2PageLayout, type HudState } from "../src/g2/hud.js";

describe("GlancePulse Market Normalizers", () => {
  it("normalizes Hyperliquid metaAndAssetCtxs cleanly", () => {
    const sample = [
      { universe: [{ name: "BTC" }, { name: "ETH" }] },
      [
        { markPx: "60000", prevDayPx: "58000", funding: "0.0001", dayNtlVlm: "1200000000" },
        { markPx: "2000", prevDayPx: "2050", funding: "-0.0002", dayNtlVlm: "450000000" },
      ],
    ];
    const items = normalizeHyperliquid(sample, "2026-11-25T14:00:00Z");
    expect(items).toHaveLength(2);
    expect(items[0].symbol).toBe("BTC-PERP");
    expect(items[0].price).toBe(60000);
    expect(items[0].metaDisplay).toContain("+3.45%");
    expect(items[1].metaDisplay).toContain("-2.44%");
  });

  it("normalizes Polymarket Gamma API markets cleanly", () => {
    const sample = [
      {
        id: "pm-1",
        question: "Will BTC close above $70,000 in December 2026?",
        outcomePrices: '["0.425", "0.575"]',
        volume24hr: 2450000,
      },
    ];
    const items = normalizePolymarket(sample, "2026-11-25T14:00:00Z");
    expect(items).toHaveLength(1);
    expect(items[0].price).toBeCloseTo(0.425, 4);
    expect(items[0].priceDisplay).toBe("42.5% YES");
    expect(items[0].metaDisplay).toContain("$2.5M");
  });
});

describe("GlancePulse Read+Write Order & Alert Ledger", () => {
  it("executes Hyperliquid LONG, tracks live uPnL, and settles realized PnL on 1-tap close", () => {
    const ledger = new GlanceLedger();
    const btc = normalizeHyperliquid(
      [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "50000", prevDayPx: "50000", funding: "0.0001", dayNtlVlm: "1000000" }],
      ],
      "2026-11-25T14:00:00Z",
    )[0];

    const order = ledger.placeOrder(btc, "LONG", 1000);
    expect(order.id).toBe("GP-0001");

    const snapUp = ledger.evaluate([{ ...btc, price: 55000 }]);
    expect(snapUp.unrealizedPnlUsd).toBe(100);
    expect(snapUp.openCount).toBe(1);

    const closed = ledger.closeOrder(order.id, 55000);
    expect(closed.status).toBe("CLOSED");
    expect(closed.realizedPnlUsd).toBe(100);

    const finalSnap = ledger.evaluate([{ ...btc, price: 55000 }]);
    expect(finalSnap.balanceUsd).toBe(10100);
    expect(finalSnap.openCount).toBe(0);
  });

  it("executes Polymarket BUY_YES and triggers threshold alerts automatically", () => {
    const ledger = new GlanceLedger();
    const mkt = normalizePolymarket(
      [{ id: "42", question: "Fed rate cut?", outcomePrices: '["0.40","0.60"]', volume24hr: 500000 }],
      "2026-11-25T14:00:00Z",
    )[0];

    const order = ledger.placeOrder(mkt, "BUY_YES", 40);
    const alert = ledger.createAlert(mkt, "ABOVE", 0.5);
    expect(alert.triggered).toBe(false);

    const snap = ledger.evaluate([{ ...mkt, price: 0.6 }]);
    // Bought 100 shares at 0.40 -> now worth $60 -> +$20 unrealized PnL
    expect(snap.unrealizedPnlUsd).toBe(20);
    expect(snap.alerts[0].triggered).toBe(true);
    expect(order.side).toBe("BUY_YES");
  });
});

describe("Even G2 576x288 SDK Container Layout Compliance", () => {
  const btc = normalizeHyperliquid(
    [
      { universe: [{ name: "BTC" }] },
      [{ markPx: "58000", prevDayPx: "57000", funding: "0.0001", dayNtlVlm: "900000000" }],
    ],
    "2026-11-25T14:00:00Z",
  )[0];
  const basePortfolio = new GlanceLedger().evaluate([btc]);

  it("validates GLANCE, ACTION, CONFIRM, and POSITIONS pages against all SDK 0.0.16 rules", () => {
    const states: HudState[] = [
      { view: "GLANCE", filter: "ALL", markets: [btc], portfolio: basePortfolio },
      { view: "ACTION", filter: "ALL", markets: [btc], portfolio: basePortfolio, selectedMarket: btc },
      {
        view: "CONFIRM",
        filter: "ALL",
        markets: [btc],
        portfolio: basePortfolio,
        selectedMarket: btc,
        pendingConfirm: { market: btc, actionType: "ORDER", side: "LONG", notionalUsd: 100 },
      },
      { view: "POSITIONS", filter: "ALL", markets: [btc], portfolio: basePortfolio },
    ];

    for (const s of states) {
      const page = buildG2Page(s);
      const errs = validateG2PageLayout(page);
      expect(errs).toEqual([]);
    }
  });
});
