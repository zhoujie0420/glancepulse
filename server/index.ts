import http from "node:http";
import { fetchLiveMarkets } from "./marketData.js";
import { GlanceLedger } from "./ledger.js";
import type { OrderSide } from "../src/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const ledger = new GlanceLedger();

async function sendTelegramNotice(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Non-blocking optional notification
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, service: "glancepulse-backend", ts: new Date().toISOString() });
    }

    if (req.method === "GET" && url.pathname === "/api/feed") {
      const force = url.searchParams.get("force") === "1";
      const { markets, live, fetchedAt } = await fetchLiveMarkets(force);
      const portfolio = ledger.evaluate(markets);
      return sendJson(res, 200, { live, fetchedAt, markets, portfolio });
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const body = await readJsonBody(req);
      const marketId = String(body.marketId ?? "");
      const side = String(body.side ?? "") as OrderSide;
      const notionalUsd = Number(body.notionalUsd ?? 100);
      const { markets } = await fetchLiveMarkets(false);
      const market = markets.find((m) => m.id === marketId);
      if (!market) return sendJson(res, 404, { error: `Unknown marketId: ${marketId}` });

      const order = ledger.placeOrder(market, side, notionalUsd);
      void sendTelegramNotice(
        `[GlancePulse G2] Executed ${order.side} $${order.notionalUsd} on ${order.symbol} @ ${market.priceDisplay} (${order.id})`,
      );
      return sendJson(res, 201, { order, portfolio: ledger.evaluate(markets) });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/close")) {
      const orderId = url.pathname.split("/")[3];
      const { markets } = await fetchLiveMarkets(true);
      const snap = ledger.evaluate(markets);
      const existing = snap.orders.find((o) => o.id === orderId);
      if (!existing) return sendJson(res, 404, { error: `Order ${orderId} not found` });
      const liveMkt = markets.find((m) => m.id === existing.marketId);
      const closed = ledger.closeOrder(orderId, liveMkt?.price ?? existing.entryPrice);
      void sendTelegramNotice(
        `[GlancePulse G2] Closed ${closed.id} (${closed.symbol}) Realized PnL: $${closed.realizedPnlUsd}`,
      );
      return sendJson(res, 200, { order: closed, portfolio: ledger.evaluate(markets) });
    }

    if (req.method === "POST" && url.pathname === "/api/alerts") {
      const body = await readJsonBody(req);
      const marketId = String(body.marketId ?? "");
      const direction = String(body.direction ?? "ABOVE") as "ABOVE" | "BELOW";
      const targetPrice = Number(body.targetPrice ?? 0);
      const { markets } = await fetchLiveMarkets(false);
      const market = markets.find((m) => m.id === marketId);
      if (!market) return sendJson(res, 404, { error: `Unknown marketId: ${marketId}` });
      const alert = ledger.createAlert(market, direction, targetPrice);
      return sendJson(res, 201, { alert, portfolio: ledger.evaluate(markets) });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[GlancePulse] Backend listening on http://127.0.0.1:${PORT}`);
});
