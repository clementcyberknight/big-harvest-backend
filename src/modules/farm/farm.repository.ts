import type { Redis } from "ioredis";
import { ownedPlotsKey, plotKey } from "../../infrastructure/redis/keys.js";

export class FarmRepository {
  async isPlotOwned(redis: Redis, userId: string, plotId: number): Promise<boolean> {
    const key = ownedPlotsKey(userId);
    const member = await redis.sismember(key, String(plotId));
    return member === 1;
  }

  async getPlots(redis: Redis, userId: string): Promise<any[]> {
    const key = ownedPlotsKey(userId);
    const plotIds = await redis.smembers(key);

    const plots = await Promise.all(
      plotIds.map(async (id) => {
        const state = await redis.hgetall(plotKey(userId, Number(id)));
        return {
          plotId: Number(id),
          ...state,
        };
      })
    );

    return plots;
  }
}
