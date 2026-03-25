import type { Redis } from "ioredis";
import type { MarketAnomaly } from "./analytics.types.js";

const ANALYTICS_ANOMALIES_KEY = "ravolo:analytics:anomalies";
const FLOW_TTL_SEC = 24 * 60 * 60;
const ANOMALY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class AnalyticsRepository {
  constructor(private readonly redis: Redis) {}

  async reportAnomaly(anomaly: MarketAnomaly): Promise<void> {
    const payload = JSON.stringify(anomaly);
    await this.redis.zadd(ANALYTICS_ANOMALIES_KEY, anomaly.detectedAtMs, payload);
    await this.redis.zremrangebyscore(ANALYTICS_ANOMALIES_KEY, "-inf", Date.now() - ANOMALY_RETENTION_MS);
  }

  async getRecentAnomalies(sinceMs: number): Promise<MarketAnomaly[]> {
    const raw = await this.redis.zrangebyscore(ANALYTICS_ANOMALIES_KEY, sinceMs, "+inf");
    return raw.map((r) => JSON.parse(r) as MarketAnomaly);
  }

  async recordTradeVolume(
    syndicateId: string | null,
    itemId: string,
    action: "buy" | "sell",
    quantity: number,
  ): Promise<void> {
    if (!syndicateId) return;
    const key = `ravolo:analytics:syndicate:${syndicateId}:flow:${itemId}`;
    await this.redis.hincrby(key, action, quantity);
    await this.redis.expire(key, FLOW_TTL_SEC);
  }

  async getSyndicateFlow(
    syndicateId: string,
    itemId: string,
  ): Promise<{ buy: number; sell: number }> {
    const key = `ravolo:analytics:syndicate:${syndicateId}:flow:${itemId}`;
    const raw = await this.redis.hgetall(key);
    return {
      buy: Number(raw.buy) || 0,
      sell: Number(raw.sell) || 0,
    };
  }
}
