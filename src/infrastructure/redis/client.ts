import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";

let shared: Redis | null = null;

export function getRedis(): Redis {
  if (!shared) {
    shared = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    shared.on("error", (err: Error) => {
      logger.error({ err }, "redis connection error");
    });
  }
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
