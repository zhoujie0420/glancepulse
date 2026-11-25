import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { MarketItem, OrderSide, PortfolioSnapshot } from "../types.js";

export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;

export type HudView = "GLANCE" | "ACTION" | "CONFIRM" | "POSITIONS";
export type FeedFilter = "ALL" | "HYPERLIQUID" | "POLYMARKET";

export const MENU_IDS = {
  POSITIONS: 1,
  SWITCH_FEED: 2,
  REFRESH: 3,
  BACK_HOME: 4,
} as const;

export interface PendingConfirm {
  market: MarketItem;
  actionType: "ORDER" | "ALERT";
  side?: OrderSide;
  notionalUsd?: number;
  alertDirection?: "ABOVE" | "BELOW";
  alertTarget?: number;
}

export interface HudState {
  view: HudView;
  filter: FeedFilter;
  markets: MarketItem[];
  portfolio: PortfolioSnapshot;
  selectedMarket?: MarketItem;
  pendingConfirm?: PendingConfirm;
  toast?: string;
}

export function formatSignedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function baseMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: MENU_IDS.POSITIONS, itemName: "Positions" }),
      new MenuItemProperty({ itemID: MENU_IDS.SWITCH_FEED, itemName: "Switch Feed" }),
      new MenuItemProperty({ itemID: MENU_IDS.REFRESH, itemName: "Refresh Live" }),
      new MenuItemProperty({ itemID: MENU_IDS.BACK_HOME, itemName: "Home Glance" }),
    ],
  });
}

export function filterMarkets(markets: MarketItem[], filter: FeedFilter): MarketItem[] {
  if (filter === "HYPERLIQUID") return markets.filter((m) => m.source === "hyperliquid");
  if (filter === "POLYMARKET") return markets.filter((m) => m.source === "polymarket");
  return markets;
}

export function buildG2Page(state: HudState): CreateStartUpPageContainer {
  const pnlStr = formatSignedUsd(state.portfolio.unrealizedPnlUsd);
  const headerText = `GLANCEPULSE · ${state.filter} · POS:${state.portfolio.openCount} (${pnlStr})`;

  if (state.view === "ACTION" && state.selectedMarket) {
    const m = state.selectedMarket;
    const actions =
      m.source === "hyperliquid"
        ? [
            `LONG $100 @ ${m.priceDisplay}`,
            `SHORT $100 @ ${m.priceDisplay}`,
            `ALERT +2% (${(m.price * 1.02).toFixed(m.price >= 100 ? 1 : 3)})`,
            "← Back to Feed",
          ]
        : [
            `BUY YES $25 (${m.priceDisplay})`,
            `BUY NO $25 (${((1 - m.price) * 100).toFixed(1)}%)`,
            `ALERT YES >= ${Math.min(99, Math.round(m.price * 100 + 5))}%`,
            "← Back to Feed",
          ];

    return new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: "action-header",
          xPosition: 16,
          yPosition: 10,
          width: 544,
          height: 30,
          zOrderIndex: 1,
          content: `${m.source.toUpperCase()} · ${m.symbol}`,
          textColor: 4,
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID: 2,
          containerName: "action-metrics",
          xPosition: 16,
          yPosition: 44,
          width: 544,
          height: 36,
          zOrderIndex: 2,
          content: `${m.priceDisplay}   ${m.metaDisplay}`,
          textColor: 3,
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 3,
          containerName: "action-list",
          xPosition: 16,
          yPosition: 88,
          width: 544,
          height: 184,
          zOrderIndex: 3,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: actions.length,
            itemWidth: 530,
            itemName: actions,
          }),
        }),
      ],
      menuObject: baseMenu(),
    });
  }

  if (state.view === "CONFIRM" && state.pendingConfirm) {
    const p = state.pendingConfirm;
    const summary =
      p.actionType === "ORDER"
        ? `${p.side} $${p.notionalUsd} on ${p.market.symbol} @ ${p.market.priceDisplay}`
        : `SET ALERT ${p.market.symbol} ${p.alertDirection} ${p.alertTarget}`;

    return new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: "confirm-title",
          xPosition: 16,
          yPosition: 12,
          width: 544,
          height: 32,
          zOrderIndex: 1,
          content: "1-TAP EXECUTION CONFIRMATION",
          textColor: 4,
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID: 2,
          containerName: "confirm-body",
          xPosition: 16,
          yPosition: 52,
          width: 544,
          height: 54,
          zOrderIndex: 2,
          content: summary,
          textColor: 4,
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 3,
          containerName: "confirm-list",
          xPosition: 16,
          yPosition: 120,
          width: 544,
          height: 152,
          zOrderIndex: 3,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: 2,
            itemWidth: 530,
            itemName: ["✓ CONFIRM & EXECUTE NOW", "✕ CANCEL"],
          }),
        }),
      ],
      menuObject: baseMenu(),
    });
  }

  if (state.view === "POSITIONS") {
    const openOrders = state.portfolio.orders.filter((o) => o.status === "OPEN");
    const items =
      openOrders.length > 0
        ? [
            ...openOrders.slice(0, 6).map(
              (o) =>
                `CLOSE ${o.id} ${o.side} ${o.symbol} (${formatSignedUsd(o.unrealizedPnlUsd ?? 0)})`,
            ),
            "← Back to Feed",
          ]
        : ["No open positions yet", "← Back to Feed"];

    return new CreateStartUpPageContainer({
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: "pos-header",
          xPosition: 16,
          yPosition: 10,
          width: 544,
          height: 32,
          zOrderIndex: 1,
          content: `BAL $${state.portfolio.balanceUsd.toFixed(0)} · uPnL ${pnlStr} · rPnL ${formatSignedUsd(state.portfolio.realizedPnlUsd)}`,
          textColor: 4,
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: 2,
          containerName: "pos-list",
          xPosition: 16,
          yPosition: 50,
          width: 544,
          height: 222,
          zOrderIndex: 2,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: items.length,
            itemWidth: 530,
            itemName: items,
          }),
        }),
      ],
      menuObject: baseMenu(),
    });
  }

  // Default: GLANCE feed
  const visible = filterMarkets(state.markets, state.filter).slice(0, 8);
  const listNames =
    visible.length > 0
      ? visible.map((m) => `${m.symbol}  ${m.priceDisplay}`)
      : ["Loading live Hyperliquid & Polymarket feeds..."];

  return new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [
      new TextContainerProperty({
        containerID: 1,
        containerName: "glance-header",
        xPosition: 16,
        yPosition: 8,
        width: 544,
        height: 28,
        zOrderIndex: 1,
        content: state.toast ? `${state.toast}` : headerText,
        textColor: 4,
        isEventCapture: 0,
      }),
      new TextContainerProperty({
        containerID: 2,
        containerName: "glance-hint",
        xPosition: 16,
        yPosition: 256,
        width: 544,
        height: 24,
        zOrderIndex: 2,
        content: "RING: Scroll · TAP: Trade/Alert · LONG-PRESS: Menu",
        textColor: 2,
        isEventCapture: 0,
      }),
    ],
    listObject: [
      new ListContainerProperty({
        containerID: 3,
        containerName: "glance-list",
        xPosition: 16,
        yPosition: 42,
        width: 544,
        height: 208,
        zOrderIndex: 3,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: listNames.length,
          itemWidth: 530,
          itemName: listNames,
        }),
      }),
    ],
    menuObject: baseMenu(),
  });
}

/**
 * Validates every official Even Hub SDK 0.0.16 G2 container rule so tests
 * catch any layout or protocol violation before packaging `.ehpk`.
 */
export function validateG2PageLayout(page: CreateStartUpPageContainer): string[] {
  const errors: string[] = [];
  const texts = page.textObject ?? [];
  const lists = page.listObject ?? [];
  const images = page.imageObject ?? [];
  const all = [...texts, ...lists, ...images];

  if (page.containerTotalNum !== all.length) {
    errors.push(`containerTotalNum (${page.containerTotalNum}) != actual (${all.length})`);
  }
  if (all.length < 1 || all.length > 12) {
    errors.push(`container count ${all.length} out of range 1..12`);
  }
  if (texts.length > 8) {
    errors.push(`textObject count ${texts.length} exceeds max 8`);
  }

  let captureCount = 0;
  const zSet = new Set<number>();
  for (const c of all) {
    const x = c.xPosition ?? 0;
    const y = c.yPosition ?? 0;
    const w = c.width ?? 0;
    const h = c.height ?? 0;
    if (x < 0 || y < 0 || x + w > G2_WIDTH || y + h > G2_HEIGHT) {
      errors.push(`container ${c.containerName} out of 576x288 bounds`);
    }
    if ("isEventCapture" in c && c.isEventCapture === 1) captureCount++;
    if (c.zOrderIndex === undefined) {
      errors.push(`container ${c.containerName} missing zOrderIndex`);
    } else if (zSet.has(c.zOrderIndex)) {
      errors.push(`duplicate zOrderIndex ${c.zOrderIndex}`);
    } else {
      zSet.add(c.zOrderIndex);
    }
  }
  if (captureCount !== 1) {
    errors.push(`expected exactly 1 isEventCapture container, got ${captureCount}`);
  }

  for (const t of texts) {
    if (t.textColor !== undefined && (t.textColor < 0 || t.textColor > 4)) {
      errors.push(`textColor ${t.textColor} out of 0..4`);
    }
  }

  if (page.menuObject?.menuItems) {
    const items = page.menuObject.menuItems;
    if (items.length > 10) errors.push(`menu items ${items.length} exceeds 10`);
    const ids = new Set<number>();
    for (const item of items) {
      if (item.itemID === undefined || item.itemID <= 0) {
        errors.push(`invalid menu itemID ${item.itemID}`);
      } else if (ids.has(item.itemID)) {
        errors.push(`duplicate menu itemID ${item.itemID}`);
      } else {
        ids.add(item.itemID);
      }
      const bytes = new TextEncoder().encode(item.itemName ?? "").length;
      if (bytes > 32) errors.push(`menu item "${item.itemName}" exceeds 32 UTF-8 bytes`);
    }
  }
  return errors;
}
