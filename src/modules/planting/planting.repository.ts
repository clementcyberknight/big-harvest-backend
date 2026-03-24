import type { Redis } from "ioredis";
import { inventoryKey, plantIdempotencyKey, plotKey, seedInventoryField } from "../../infrastructure/redis/keys.js";
import { redisPlant } from "../../infrastructure/redis/commands.js";
import type { CropId } from "../crop/crop.config.js";
import type { PlantResult } from "./planting.types.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export class PlantingRepository {
  async plantAtomic(
    redis: Redis,
    userId: string,
    params: {
      plotId: number;
      cropId: CropId;
      requestId: string;
      plantedAtMs: number;
      readyAtMs: number;
      outputQty: number;
      seedCost: number;
      harvestItem: string;
    },
  ): Promise<PlantResult> {
    const keys = {
      plotKey: plotKey(userId, params.plotId),
      invKey: inventoryKey(userId),
      idempKey: plantIdempotencyKey(userId, params.requestId),
    };
    const seedField = seedInventoryField(params.cropId);

    try {
      const res = await redisPlant(redis, keys, {
        cropId: params.cropId,
        plantedAtMs: params.plantedAtMs,
        readyAtMs: params.readyAtMs,
        outputQty: params.outputQty,
        seedField,
        seedCost: params.seedCost,
        harvestItem: params.harvestItem,
      });
      return {
        cropId: res.cropId,
        plantedAtMs: res.plantedAtMs,
        readyAtMs: res.readyAtMs,
        outputQty: res.outputQty,
        idempotentReplay: "idempotentReplay" in res ? res.idempotentReplay : undefined,
      };
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_PLOT_OCCUPIED")) {
        const err = new Error("PLOT_OCCUPIED");
        (err as Error & { code: string }).code = "PLOT_OCCUPIED";
        throw err;
      }
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_SEEDS")) {
        const err = new Error("INSUFFICIENT_SEEDS");
        (err as Error & { code: string }).code = "INSUFFICIENT_SEEDS";
        throw err;
      }
      throw e;
    }
  }
}
