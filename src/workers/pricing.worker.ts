import type { Redis } from "ioredis";
import {
  PRICE_DEMAND_CLAMP,
  PRICE_SCARCITY_CLAMP,
  PRICE_VOLATILITY_CLAMP,
  PRICING_TICK_MS,
  SCARCITY_TOTAL_UNITS,
} from "../config/constants.js";
import { logger } from "../infrastructure/logger/logger.js";
import {
  treasuryBuyFlowKey,
  treasuryPriceHistoryKey,
  treasuryPricesKey,
  treasurySellFlowKey,
} from "../infrastructure/redis/keys.js";
import { PRICED_ITEM_IDS, resolveBaseMicro } from "../modules/market/market.catalog.js";
import { mean, standardDeviation } from "simple-statistics";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export async function runPricingTick(redis: Redis): Promise<void> {
  const pricesK = treasuryPricesKey();
  const buyK = treasuryBuyFlowKey();
  const sellK = treasurySellFlowKey();

  const pipe = redis.multi();
  for (const id of PRICED_ITEM_IDS) {
    pipe.hget(buyK, id);
    pipe.hget(sellK, id);
  }
  const raw = await pipe.exec();
  if (!raw) return;

  const histLists = await Promise.all(
    PRICED_ITEM_IDS.map((item) => redis.lrange(treasuryPriceHistoryKey(item), 0, -1)),
  );

  const updates: { item: string; micro: number }[] = [];
  const decay: { key: string; field: string; value: number }[] = [];

  for (let i = 0; i < PRICED_ITEM_IDS.length; i++) {
    const item = PRICED_ITEM_IDS[i]!;
    const bi = i * 2;
    const buy = Number(raw[bi]?.[1] ?? 0) || 0;
    const sell = Number(raw[bi + 1]?.[1] ?? 0) || 0;

    const demandRaw = (buy + 1) / (sell + 1);
    const demand = clamp(demandRaw, PRICE_DEMAND_CLAMP[0], PRICE_DEMAND_CLAMP[1]);

    const circ = buy + sell;
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
    let next = Math.round(base * demand * scarcity * vol);
    next = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, next));
    updates.push({ item, micro: next });

    decay.push({ key: buyK, field: item, value: Math.floor(buy * 0.9) });
    decay.push({ key: sellK, field: item, value: Math.floor(sell * 0.9) });
  }

  const w = redis.multi();
  for (const u of updates) {
    w.hset(pricesK, u.item, String(u.micro));
    w.rpush(treasuryPriceHistoryKey(u.item), String(u.micro));
    w.ltrim(treasuryPriceHistoryKey(u.item), -20, -1);
  }
  for (const d of decay) {
    if (d.value > 0) w.hset(d.key, d.field, String(d.value));
    else w.hdel(d.key, d.field);
  }
  await w.exec();
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
