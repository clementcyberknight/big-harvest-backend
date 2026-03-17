import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";

export const redis: RedisClientType = createClient({
  url: env.redisUrl,
});

redis.on("error", (err) => console.log("Redis Client Error", err));
redis.on("connect", () => console.log("Redis Client Connected"));

export async function initRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}
