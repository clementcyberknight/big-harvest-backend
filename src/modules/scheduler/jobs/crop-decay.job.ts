import type { Redis } from "ioredis";
import { logger } from "../../../infrastructure/logger/logger.js";
import { redisDecay } from "../../../infrastructure/redis/commands.js";
import { CROP_CONFIG, type CropId } from "../../crop/crop.config.js";

const DEFAULT_DECAY_MS = 24 * 60 * 60 * 1000; // 24 hours baseline
const CROP_DECAY_SCALAR = 3; // Crops decay after 3x their grow time (min 24h)

export async function runCropDecayTick(redis: Redis): Promise<void> {
  let cursor = "0";
  let decayedCount = 0;
  const now = Date.now();

  try {
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        "ravolo:*:plot:*",
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        // Find cropId to calculate maxDecay
        const cropId = (await redis.hget(key, "cropId")) as CropId | null;
        if (!cropId) continue;

        const config = CROP_CONFIG[cropId];
        if (!config) continue;

        const decayMs = Math.max(
          DEFAULT_DECAY_MS,
          config.growTimeSec * 1000 * CROP_DECAY_SCALAR,
        );

        const res = await redisDecay(redis, key, now, decayMs);
        if (res === "DECAYED") {
          decayedCount++;
        }
      }
    } while (cursor !== "0");

    if (decayedCount > 0) {
      logger.info(
        { decayedCount },
        "[scheduler] Crop decay tick processed dead crops",
      );
    }
  } catch (err) {
    logger.error({ err }, "[scheduler] Crop decay tick failed");
  }
}
