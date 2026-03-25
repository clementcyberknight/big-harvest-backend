import type { Redis } from "ioredis";
import { AnalyticsRepository } from "./analytics.repository.js";
import type { MarketAnomaly } from "./analytics.types.js";
import { PRICED_ITEM_IDS } from "../market/market.catalog.js";
import { syndicateIndexAllKey, syndicateBankItemsKey, syndicateTaxPenaltyKey } from "../../infrastructure/redis/keys.js";
import { logger } from "../../infrastructure/logger/logger.js";

const HOARDING_THRESHOLD = 5000;
const WASH_TRADE_MIN_VOLUME = 1000;
const WASH_TRADE_RATIO = 0.8;

export class AnalyticsService {
  private repo: AnalyticsRepository;

  constructor(private readonly redis: Redis) {
    this.repo = new AnalyticsRepository(redis);
  }

  async recordTrade(
    syndicateId: string | null,
    itemId: string,
    action: "buy" | "sell",
    quantity: number,
  ): Promise<void> {
    await this.repo.recordTradeVolume(syndicateId, itemId, action, quantity);
  }

  async detectManipulation(): Promise<MarketAnomaly[]> {
    const anomalies: MarketAnomaly[] = [];
    const syndicates = await this.redis.smembers(syndicateIndexAllKey());

    for (const sid of syndicates) {
      for (const item of PRICED_ITEM_IDS) {
        const flow = await this.repo.getSyndicateFlow(sid, item);
        const totalVolume = flow.buy + flow.sell;
        if (totalVolume > WASH_TRADE_MIN_VOLUME) {
          const ratio = Math.min(flow.buy, flow.sell) / Math.max(flow.buy, flow.sell);
          if (ratio > WASH_TRADE_RATIO) {
            // Apply a 20% tax penalty flag for 24 hours
            await this.redis.set(syndicateTaxPenaltyKey(sid), "1", "EX", 24 * 60 * 60);

            anomalies.push({
              type: "wash_trading",
              entityId: sid,
              entityType: "syndicate",
              itemId: item,
              severity: ratio,
              description: `Syndicate wash trading detected for ${item} (buy: ${flow.buy}, sell: ${flow.sell}). 20% tax penalty applied.`,
              detectedAtMs: Date.now(),
            });
          }
        }
      }
    }
    return anomalies;
  }

  async detectHoarding(): Promise<MarketAnomaly[]> {
    const anomalies: MarketAnomaly[] = [];
    const syndicates = await this.redis.smembers(syndicateIndexAllKey());

    for (const sid of syndicates) {
      const inv = await this.redis.hgetall(syndicateBankItemsKey(sid));
      for (const [item, qtyStr] of Object.entries(inv)) {
        const qty = Number(qtyStr) || 0;
        if (qty > HOARDING_THRESHOLD) {
          const severity = Math.min(1.0, qty / (HOARDING_THRESHOLD * 5));
          anomalies.push({
            type: "hoarding",
            entityId: sid,
            entityType: "syndicate",
            itemId: item,
            severity,
            description: `Syndicate hoarding ${qty} units of ${item}`,
            detectedAtMs: Date.now(),
          });
        }
      }
    }
    return anomalies;
  }

  async runPeriodicAnalysis(): Promise<MarketAnomaly[]> {
    try {
      const all = [...(await this.detectHoarding()), ...(await this.detectManipulation())];
      for (const anomaly of all) {
        await this.repo.reportAnomaly(anomaly);
        logger.warn({ anomaly }, `[analytics] ${anomaly.type.toUpperCase()} detected on ${anomaly.itemId}`);
      }
      return all;
    } catch (err) {
      logger.error({ err }, "[analytics] Periodic analysis failed");
      return [];
    }
  }

  async getRecentAnomalies(timeWindowMs: number): Promise<MarketAnomaly[]> {
    return this.repo.getRecentAnomalies(Date.now() - timeWindowMs);
  }
}
