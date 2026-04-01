import type { Redis } from "ioredis";
import { redisBuyPlot } from "../../infrastructure/redis/commands.js";
import {
  buyPlotIdempotencyKey,
  ownedPlotsKey,
  plotKey,
  plotSeqKey,
  plotsLockedKey,
  treasuryReserveKey,
  walletKey,
} from "../../infrastructure/redis/keys.js";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";
import type { BuyPlotResult } from "./farm.types.js";

export class FarmRepository {
  async isPlotOwned(
    redis: Redis,
    userId: string,
    plotId: number,
  ): Promise<boolean> {
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
      }),
    );

    return plots;
  }

  async buyPlotAtomic(
    redis: Redis,
    userId: string,
    params: {
      requestId: string;
      starterPlotCount: number;
      maxPlots: number;
      baseGold: number;
      stepGold: number;
    },
  ): Promise<BuyPlotResult> {
    const plotKeyPrefix = `${plotKey(userId, 0).slice(0, -1)}`;
    const result = await redisBuyPlot(
      redis,
      {
        walletKey: walletKey(userId),
        plotsKey: ownedPlotsKey(userId),
        plotsLockedKey: plotsLockedKey(userId),
        plotSeqKey: plotSeqKey(userId),
        idempKey: buyPlotIdempotencyKey(userId, params.requestId),
        reserveKey: treasuryReserveKey(),
      },
      {
        starterPlotCount: params.starterPlotCount,
        maxPlots: params.maxPlots,
        baseGold: params.baseGold,
        stepGold: params.stepGold,
        idempTtlSec: IDEMPOTENCY_TTL_SEC,
        plotKeyPrefix,
      },
    );

    return {
      plotId: result.plotId,
      goldSpent: result.gold,
      totalOwnedPlots: result.plotId + 1,
    };
  }
}
