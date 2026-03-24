import type { Redis } from "ioredis";
import { harvestIdempotencyKey, inventoryKey, plotKey } from "../../infrastructure/redis/keys.js";
import { redisHarvest } from "../../infrastructure/redis/commands.js";
import type { HarvestResult } from "./harvesting.types.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export class HarvestingRepository {
  async harvestAtomic(
    redis: Redis,
    userId: string,
    params: { plotId: number; requestId: string; nowMs: number },
  ): Promise<HarvestResult> {
    const keys = {
      plotKey: plotKey(userId, params.plotId),
      invKey: inventoryKey(userId),
      idempKey: harvestIdempotencyKey(userId, params.requestId),
    };

    try {
      const res = await redisHarvest(redis, keys, { nowMs: params.nowMs });
      return {
        itemId: res.itemId,
        quantity: res.quantity,
        idempotentReplay: "idempotentReplay" in res ? res.idempotentReplay : undefined,
      };
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_EMPTY_PLOT")) {
        const err = new Error("EMPTY_PLOT");
        (err as Error & { code: string }).code = "EMPTY_PLOT";
        throw err;
      }
      if (isReplyError(e) && e.message.includes("ERR_NOT_READY")) {
        const err = new Error("NOT_READY");
        (err as Error & { code: string }).code = "NOT_READY";
        throw err;
      }
      if (isReplyError(e) && e.message.includes("ERR_INVALID_OUTPUT")) {
        const err = new Error("INVALID_OUTPUT");
        (err as Error & { code: string }).code = "INVALID_OUTPUT";
        throw err;
      }
      throw e;
    }
  }
}
