import type { Redis } from "ioredis";
import {
  PRICE_DEMAND_CLAMP,
  PRICE_SCARCITY_CLAMP,
  PRICE_VOLATILITY_CLAMP,
  PRICING_TICK_MS,
  SCARCITY_TOTAL_UNITS,
  SPREAD_BUY_FACTOR,
  SPREAD_SELL_FACTOR,
} from "../config/constants.js";
import { logger } from "../infrastructure/logger/logger.js";
import {
  treasuryBuyFlowKey,
  treasuryBuyPricesKey,
  treasuryPriceHistoryKey,
  treasuryPricesKey,
  treasurySellFlowKey,
  treasurySellPricesKey,
} from "../infrastructure/redis/keys.js";
import { PRICED_ITEM_IDS, resolveBaseMicro } from "../modules/market/market.catalog.js";
import { mean, standardDeviation } from "simple-statistics";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export async function runPricingTick(redis: Redis, onComplete?: () => Promise<void>): Promise<void> {
  const pricesK = treasuryPricesKey();
  const buyPricesK = treasuryBuyPricesKey();
  const sellPricesK = treasurySellPricesKey();
  const buyFlowK = treasuryBuyFlowKey();
  const sellFlowK = treasurySellFlowKey();

  const pipe = redis.multi();
  for (const id of PRICED_ITEM_IDS) {
    pipe.hget(buyFlowK, id);
    pipe.hget(sellFlowK, id);
  }
  const raw = await pipe.exec();
  if (!raw) return;

  const histLists = await Promise.all(
    PRICED_ITEM_IDS.map((item) => redis.lrange(treasuryPriceHistoryKey(item), 0, -1)),
  );

  const updates: { item: string; mid: number; buy: number; sell: number }[] = [];
  const decay: { key: string; field: string; value: number }[] = [];

  for (let i = 0; i < PRICED_ITEM_IDS.length; i++) {
    const item = PRICED_ITEM_IDS[i]!;
    const bi = i * 2;
    const buyFlow = Number(raw[bi]?.[1] ?? 0) || 0;
    const sellFlow = Number(raw[bi + 1]?.[1] ?? 0) || 0;

    const demandRaw = (buyFlow + 1) / (sellFlow + 1);
    const demand = clamp(demandRaw, PRICE_DEMAND_CLAMP[0], PRICE_DEMAND_CLAMP[1]);

    const circ = buyFlow + sellFlow;
    const scarcityRaw = SCARCITY_TOTAL_UNITS / Math.max(1, circ);
    const scarcity = clamp(scarcityRaw, PRICE_SCARCITY_CLAMP[0], PRICE_SCARCITY_CLAMP[1]);

    const histRaw = histLists[i] ?? [];
    const hist = histRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    let vol = 1;
    if (hist.length >= 3) {
      const m = mean(hist);
      const sd = standardDeviation(hist);
      if (m > 0) vol = 1 + sd / m;
    }
    vol = clamp(vol, PRICE_VOLATILITY_CLAMP[0], PRICE_VOLATILITY_CLAMP[1]);

    const base = resolveBaseMicro(item);
    // Mid price: demand/scarcity/volatility driven
    let mid = Math.round(base * demand * scarcity * vol);
    mid = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, mid));

    // Apply spread: buy is more expensive, sell pays less
    const buyPrice = Math.max(1, Math.round(mid * SPREAD_BUY_FACTOR));
    const sellPrice = Math.max(1, Math.round(mid * SPREAD_SELL_FACTOR));

    updates.push({ item, mid, buy: buyPrice, sell: sellPrice });

    decay.push({ key: buyFlowK, field: item, value: Math.floor(buyFlow * 0.9) });
    decay.push({ key: sellFlowK, field: item, value: Math.floor(sellFlow * 0.9) });
  }

  const w = redis.multi();
  for (const u of updates) {
    // Store mid price (legacy key, kept for history tracking)
    w.hset(pricesK, u.item, String(u.mid));
    // Store separate buy and sell prices
    w.hset(buyPricesK, u.item, String(u.buy));
    w.hset(sellPricesK, u.item, String(u.sell));
    // History tracks the mid price for volatility calculation
    w.rpush(treasuryPriceHistoryKey(u.item), String(u.mid));
    w.ltrim(treasuryPriceHistoryKey(u.item), -20, -1);
  }
  for (const d of decay) {
    if (d.value > 0) w.hset(d.key, d.field, String(d.value));
    else w.hdel(d.key, d.field);
  }
  await w.exec();
  if (onComplete) await onComplete();
}

export function startPricingLoop(redis: Redis): () => void {
  const tick = () => {
    void runPricingTick(redis).catch((err) => {
      logger.error({ err }, "pricing tick failed");
    });
  };
  tick();
  const id = setInterval(tick, PRICING_TICK_MS);
  return () => clearInterval(id);
}
