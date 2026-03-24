import type { Redis } from "ioredis";
import { userActionsQueueKey } from "./keys.js";

/**
 * Atomically takes up to `maxItems` JSON strings from the head of the queue and removes them.
 * Uses MULTI so LRANGE+LTRIM is one transaction (single-process worker; no duplicate consumers).
 */
export async function atomicDrainUserActionBatch(
  redis: Redis,
  maxItems: number,
): Promise<string[]> {
  const key = userActionsQueueKey();
  const end = Math.max(0, maxItems - 1);
  const results = await redis.multi().lrange(key, 0, end).ltrim(key, maxItems, -1).exec();

  const rangeResult = results?.[0];
  if (!rangeResult || rangeResult[0]) {
    return [];
  }
  const raw = rangeResult[1];
  if (!Array.isArray(raw)) return [];
  return raw as string[];
}
