import "./styles.css";
import type { CreateStartUpPageContainer } from "@evenrealities/even_hub_sdk";
import { connectG2Bridge, type G2BridgeHandle } from "./g2/bridge.js";
import {
  buildG2Page,
  filterMarkets,
  formatSignedUsd,
  MENU_IDS,
  type FeedFilter,
  type HudState,
} from "./g2/hud.js";
import type { MarketItem, OrderSide, PortfolioSnapshot } from "./types.js";

const API_BASE = "";

const state: HudState = {
  view: "GLANCE",
  filter: "ALL",
  markets: [],
  portfolio: {
    balanceUsd: 10_000,
    unrealizedPnlUsd: 0,
    realizedPnlUsd: 0,
    openCount: 0,
    orders: [],
    alerts: [],
  },
};

let selectedIdx = 0;
let bridge: G2BridgeHandle;

function currentListLength(page: CreateStartUpPageContainer): number {
  const list = page.listObject?.[0];
  return list?.itemContainer?.itemName?.length ?? 0;
}

function renderBrowserPreview(page: CreateStartUpPageContainer) {
  const screen = document.getElementById("g2-screen");
  if (!screen) return;
  screen.innerHTML = "";

  for (const t of page.textObject ?? []) {
    const el = document.createElement("div");
    const colorClass = `g2-c${t.textColor ?? 4}`;
    el.className = `g2-text ${colorClass}`;
    el.style.left = `${t.xPosition ?? 0}px`;
    el.style.top = `${t.yPosition ?? 0}px`;
    el.style.width = `${t.width ?? 544}px`;
    el.style.height = `${t.height ?? 28}px`;
    el.textContent = t.content ?? "";
    screen.appendChild(el);
  }

  for (const l of page.listObject ?? []) {
    const wrap = document.createElement("div");
    wrap.className = "g2-list";
    wrap.style.left = `${l.xPosition ?? 0}px`;
    wrap.style.top = `${l.yPosition ?? 0}px`;
    wrap.style.width = `${l.width ?? 544}px`;
    wrap.style.height = `${l.height ?? 180}px`;

    const names = l.itemContainer?.itemName ?? [];
    if (selectedIdx >= names.length) selectedIdx = Math.max(0, names.length - 1);

    names.forEach((name, idx) => {
      const row = document.createElement("div");
      row.className = `g2-list-item${idx === selectedIdx ? " selected" : ""}`;
      row.textContent = `${idx === selectedIdx ? "▸ " : "  "}${name}`;
      row.addEventListener("click", () => {
        selectedIdx = idx;
        void handleSelectIndex(idx);
      });
      wrap.appendChild(row);
    });
    screen.appendChild(wrap);
  }
}

function renderLedgerPanel() {
  const summary = document.getElementById("portfolio-summary");
  const ordersEl = document.getElementById("orders-list");
  const alertsEl = document.getElementById("alerts-list");
  if (!summary || !ordersEl || !alertsEl) return;

  const p = state.portfolio;
  summary.innerHTML = `
    <div class="stat-card"><div class="stat-label">Margin Balance</div><div class="stat-val">$${p.balanceUsd.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Unrealized PnL</div><div class="stat-val">${formatSignedUsd(p.unrealizedPnlUsd)}</div></div>
    <div class="stat-card"><div class="stat-label">Realized PnL</div><div class="stat-val">${formatSignedUsd(p.realizedPnlUsd)}</div></div>
  `;

  if (p.orders.length === 0) {
    ordersEl.innerHTML = `<div class="empty-note">No orders yet. Tap any Hyperliquid perp or Polymarket odds on the G2 HUD to trade in 1 tap.</div>`;
  } else {
    ordersEl.innerHTML = p.orders
      .map((o) => {
        const pnl = o.status === "OPEN" ? o.unrealizedPnlUsd ?? 0 : o.realizedPnlUsd ?? 0;
        return `<div class="log-row"><span><strong>${o.id}</strong> ${o.side} $${o.notionalUsd} ${o.symbol}</span><span>${o.status} · ${formatSignedUsd(pnl)}</span></div>`;
      })
      .join("");
  }

  if (p.alerts.length === 0) {
    alertsEl.innerHTML = `<div class="empty-note">No active alerts. Select any market and choose ALERT.</div>`;
  } else {
    alertsEl.innerHTML = p.alerts
      .map(
        (a) =>
          `<div class="log-row"><span><strong>${a.id}</strong> ${a.symbol} ${a.direction} ${a.targetPrice}</span><span>${a.triggered ? "🔔 TRIGGERED" : "WATCHING"}</span></div>`,
      )
      .join("");
  }
}

async function syncHud() {
  const page = buildG2Page(state);
  renderBrowserPreview(page);
  renderLedgerPanel();
  await bridge.pushPage(page);
}

async function fetchFeed(force = false) {
  const res = await fetch(`${API_BASE}/api/feed${force ? "?force=1" : ""}`);
  if (!res.ok) return;
  const data = (await res.json()) as {
    live: boolean;
    markets: MarketItem[];
    portfolio: PortfolioSnapshot;
  };
  state.markets = data.markets;
  state.portfolio = data.portfolio;
  await syncHud();
}

function setToast(msg: string) {
  state.toast = msg;
  setTimeout(() => {
    if (state.toast === msg) {
      state.toast = undefined;
      void syncHud();
    }
  }, 3500);
}

async function executePending() {
  const p = state.pendingConfirm;
  if (!p) return;
  if (p.actionType === "ORDER" && p.side && p.notionalUsd) {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketId: p.market.id,
        side: p.side,
        notionalUsd: p.notionalUsd,
      }),
    });
    const body = (await res.json()) as { order?: { id: string }; portfolio?: PortfolioSnapshot; error?: string };
    if (body.portfolio) state.portfolio = body.portfolio;
    setToast(body.order ? `✓ EXECUTED ${body.order.id} (${p.side})` : `ERR: ${body.error}`);
  } else if (p.actionType === "ALERT" && p.alertDirection && p.alertTarget) {
    const res = await fetch(`${API_BASE}/api/alerts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        marketId: p.market.id,
        direction: p.alertDirection,
        targetPrice: p.alertTarget,
      }),
    });
    const body = (await res.json()) as { alert?: { id: string }; portfolio?: PortfolioSnapshot; error?: string };
    if (body.portfolio) state.portfolio = body.portfolio;
    setToast(body.alert ? `🔔 ALERT ${body.alert.id} ARMED` : `ERR: ${body.error}`);
  }
  state.pendingConfirm = undefined;
  state.selectedMarket = undefined;
  state.view = "GLANCE";
  selectedIdx = 0;
  await syncHud();
}

async function handleSelectIndex(idx: number) {
  if (state.view === "GLANCE") {
    const visible = filterMarkets(state.markets, state.filter).slice(0, 8);
    const chosen = visible[idx];
    if (!chosen) return;
    state.selectedMarket = chosen;
    state.view = "ACTION";
    selectedIdx = 0;
    await syncHud();
    return;
  }

  if (state.view === "ACTION" && state.selectedMarket) {
    const m = state.selectedMarket;
    if (idx === 3) {
      state.view = "GLANCE";
      state.selectedMarket = undefined;
      selectedIdx = 0;
      await syncHud();
      return;
    }
    if (idx === 0 || idx === 1) {
      const side: OrderSide =
        m.source === "hyperliquid"
          ? idx === 0
            ? "LONG"
            : "SHORT"
          : idx === 0
            ? "BUY_YES"
            : "BUY_NO";
      state.pendingConfirm = {
        market: m,
        actionType: "ORDER",
        side,
        notionalUsd: m.source === "hyperliquid" ? 100 : 25,
      };
    } else {
      const target =
        m.source === "hyperliquid"
          ? Number((m.price * 1.02).toFixed(4))
          : Number(Math.min(0.99, m.price + 0.05).toFixed(3));
      state.pendingConfirm = {
        market: m,
        actionType: "ALERT",
        alertDirection: "ABOVE",
        alertTarget: target,
      };
    }
    state.view = "CONFIRM";
    selectedIdx = 0;
    await syncHud();
    return;
  }

  if (state.view === "CONFIRM") {
    if (idx === 0) {
      await executePending();
    } else {
      state.pendingConfirm = undefined;
      state.view = "GLANCE";
      selectedIdx = 0;
      await syncHud();
    }
    return;
  }

  if (state.view === "POSITIONS") {
    const openOrders = state.portfolio.orders.filter((o) => o.status === "OPEN").slice(0, 6);
    if (idx < openOrders.length) {
      const target = openOrders[idx];
      const res = await fetch(`${API_BASE}/api/orders/${target.id}/close`, { method: "POST" });
      const body = (await res.json()) as {
        order?: { id: string; realizedPnlUsd?: number };
        portfolio?: PortfolioSnapshot;
      };
      if (body.portfolio) state.portfolio = body.portfolio;
      setToast(
        body.order
          ? `✓ CLOSED ${body.order.id} (${formatSignedUsd(body.order.realizedPnlUsd ?? 0)})`
          : "Close failed",
      );
      state.view = "GLANCE";
      selectedIdx = 0;
      await syncHud();
    } else {
      state.view = "GLANCE";
      selectedIdx = 0;
      await syncHud();
    }
  }
}

function cycleFilter() {
  const order: FeedFilter[] = ["ALL", "HYPERLIQUID", "POLYMARKET"];
  const next = order[(order.indexOf(state.filter) + 1) % order.length];
  state.filter = next;
  state.view = "GLANCE";
  selectedIdx = 0;
  setToast(`FEED: ${next}`);
  void syncHud();
}

async function handleMenu(itemID: number) {
  if (itemID === MENU_IDS.POSITIONS) {
    state.view = "POSITIONS";
    selectedIdx = 0;
    await syncHud();
  } else if (itemID === MENU_IDS.SWITCH_FEED) {
    cycleFilter();
  } else if (itemID === MENU_IDS.REFRESH) {
    setToast("Refreshing live feeds…");
    await fetchFeed(true);
  } else if (itemID === MENU_IDS.BACK_HOME) {
    state.view = "GLANCE";
    state.selectedMarket = undefined;
    state.pendingConfirm = undefined;
    selectedIdx = 0;
    await syncHud();
  }
}

function moveSelection(delta: number) {
  const page = buildG2Page(state);
  const len = currentListLength(page);
  if (len <= 0) return;
  selectedIdx = (selectedIdx + delta + len) % len;
  renderBrowserPreview(page);
}

async function boot() {
  bridge = await connectG2Bridge();
  const pill = document.getElementById("mode-pill");
  if (pill) {
    pill.textContent =
      bridge.mode === "even-g2" ? "Connected · Even G2 Bridge" : "Preview · Even G2 576×288 HUD";
  }

  bridge.onEvent((event) => {
    if (event.listEvent && event.listEvent.currentSelectItemIndex !== undefined) {
      void handleSelectIndex(event.listEvent.currentSelectItemIndex);
    }
    if (event.menuItemClickEvent?.itemID !== undefined) {
      void handleMenu(event.menuItemClickEvent.itemID);
    }
  });

  document.getElementById("btn-up")?.addEventListener("click", () => moveSelection(-1));
  document.getElementById("btn-down")?.addEventListener("click", () => moveSelection(1));
  document.getElementById("btn-tap")?.addEventListener("click", () => void handleSelectIndex(selectedIdx));
  document.getElementById("btn-positions")?.addEventListener("click", () => void handleMenu(MENU_IDS.POSITIONS));
  document.getElementById("btn-feed")?.addEventListener("click", () => void handleMenu(MENU_IDS.SWITCH_FEED));
  document.getElementById("btn-refresh")?.addEventListener("click", () => void handleMenu(MENU_IDS.REFRESH));

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") moveSelection(-1);
    else if (e.key === "ArrowDown") moveSelection(1);
    else if (e.key === "Enter") void handleSelectIndex(selectedIdx);
    else if (e.key.toLowerCase() === "p") void handleMenu(MENU_IDS.POSITIONS);
    else if (e.key.toLowerCase() === "f") void handleMenu(MENU_IDS.SWITCH_FEED);
    else if (e.key.toLowerCase() === "r") void handleMenu(MENU_IDS.REFRESH);
  });

  await fetchFeed(true);
  setInterval(() => void fetchFeed(false), 12_000);
}

void boot();
