import type { Redis } from "ioredis";
import { ownedPlotsKey } from "../../infrastructure/redis/keys.js";

export class FarmRepository {
  async isPlotOwned(redis: Redis, userId: string, plotId: number): Promise<boolean> {
    const key = ownedPlotsKey(userId);
    const member = await redis.sismember(key, String(plotId));
    return member === 1;
  }
}
