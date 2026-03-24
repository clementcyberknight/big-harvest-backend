/**
 * Grant extra seeds for testing (run after REDIS_URL is set).
 * Usage: pnpm exec tsx src/cli/seedInventory.ts <userId>
 */
import "dotenv/config";
import { getRedis, closeRedis } from "../infrastructure/redis/client.js";
import { inventoryKey, seedInventoryField } from "../infrastructure/redis/keys.js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx src/cli/seedInventory.ts <userId>");
  process.exit(1);
}
const redis = getRedis();
const key = inventoryKey(userId);
await redis.hset(key, seedInventoryField("wheat"), 100);
await redis.hset(key, seedInventoryField("corn"), 100);
await redis.hset(key, seedInventoryField("cacao"), 100);
console.log(`Seeded seeds for ${userId} at ${key}`);
await closeRedis();
