import type { MarketItem } from "../src/types.js";

const HYPERLIQUID_URL = "https://api.hyperliquid.xyz/info";
const POLYMARKET_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=12&order=volume24hr&ascending=false";

const FEATURED_PERPS = ["BTC", "ETH", "SOL", "HYPE", "ARB", "DOGE"];

export function formatUsdPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

export function formatCompactUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function truncateGlance(s: string, maxLen: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(1, maxLen - 1)) + "…";
}

export function normalizeHyperliquid(metaAndCtxs: unknown, nowIso: string): MarketItem[] {
  if (!Array.isArray(metaAndCtxs) || metaAndCtxs.length < 2) return [];
  const meta = metaAndCtxs[0] as { universe?: Array<{ name: string }> };
  const ctxs = metaAndCtxs[1] as Array<{
    markPx?: string;
    midPx?: string;
    prevDayPx?: string;
    funding?: string;
    dayNtlVlm?: string;
  }>;
  if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return [];

  const indexMap = new Map<string, number>();
  meta.universe.forEach((u, i) => indexMap.set(u.name, i));

  const out: MarketItem[] = [];
  for (const sym of FEATURED_PERPS) {
    const idx = indexMap.get(sym);
    if (idx === undefined || !ctxs[idx]) continue;
    const c = ctxs[idx];
    const mark = Number(c.markPx ?? c.midPx ?? 0);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    const prev = Number(c.prevDayPx ?? mark);
    const chg = prev > 0 ? ((mark - prev) / prev) * 100 : 0;
    const fundingPct = Number(c.funding ?? 0) * 100;
    const vol = Number(c.dayNtlVlm ?? 0);
    const sign = chg >= 0 ? "+" : "";
    const fSign = fundingPct >= 0 ? "+" : "";

    out.push({
      id: `hl:${sym}`,
      source: "hyperliquid",
      symbol: `${sym}-PERP`,
      title: `${sym} Perpetual (Hyperliquid)`,
      price: mark,
      priceDisplay: formatUsdPrice(mark),
      metaDisplay: `${sign}${chg.toFixed(2)}% | FR ${fSign}${fundingPct.toFixed(3)}%`,
      change24hPct: Number(chg.toFixed(2)),
      fundingRatePct: Number(fundingPct.toFixed(4)),
      volume24hUsd: vol,
      updatedAt: nowIso,
    });
  }
  return out;
}

export function normalizePolymarket(rawList: unknown, nowIso: string): MarketItem[] {
  if (!Array.isArray(rawList)) return [];
  const out: MarketItem[] = [];
  for (const item of rawList as Array<Record<string, unknown>>) {
    const q = String(item.question ?? "").trim();
    if (!q) continue;
    let yesProb = 0.5;
    try {
      const parsed =
        typeof item.outcomePrices === "string"
          ? JSON.parse(item.outcomePrices)
          : item.outcomePrices;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const v = Number(parsed[0]);
        if (Number.isFinite(v) && v >= 0 && v <= 1) yesProb = v;
      }
    } catch {
      // keep default 0.5
    }
    const vol = Number(item.volume24hr ?? item.volumeNum ?? 0);
    const id = `pm:${String(item.id ?? item.slug ?? out.length)}`;
    const pct = (yesProb * 100).toFixed(1);
    out.push({
      id,
      source: "polymarket",
      symbol: truncateGlance(q, 24),
      title: q,
      price: yesProb,
      priceDisplay: `${pct}% YES`,
      metaDisplay: `NO ${((1 - yesProb) * 100).toFixed(1)}% | 24h ${formatCompactUsd(vol)}`,
      volume24hUsd: vol,
      updatedAt: nowIso,
    });
    if (out.length >= 6) break;
  }
  return out;
}

let cachedMarkets: MarketItem[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 8_000;

export async function fetchLiveMarkets(force = false): Promise<{
  markets: MarketItem[];
  live: boolean;
  fetchedAt: string;
}> {
  const now = Date.now();
  if (!force && cachedMarkets.length > 0 && now - cachedAt < CACHE_TTL_MS) {
    return {
      markets: cachedMarkets,
      live: true,
      fetchedAt: new Date(cachedAt).toISOString(),
    };
  }

  const nowIso = new Date(now).toISOString();
  const [hlRes, pmRes] = await Promise.allSettled([
    fetch(HYPERLIQUID_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HL ${r.status}`)))),
    fetch(POLYMARKET_URL, {
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`PM ${r.status}`)))),
  ]);

  const hlItems = hlRes.status === "fulfilled" ? normalizeHyperliquid(hlRes.value, nowIso) : [];
  const pmItems = pmRes.status === "fulfilled" ? normalizePolymarket(pmRes.value, nowIso) : [];
  const combined = [...hlItems, ...pmItems];

  if (combined.length > 0) {
    cachedMarkets = combined;
    cachedAt = now;
    return { markets: combined, live: true, fetchedAt: nowIso };
  }

  return {
    markets: cachedMarkets,
    live: false,
    fetchedAt: nowIso,
  };
}
