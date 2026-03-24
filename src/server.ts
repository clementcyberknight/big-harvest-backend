import { startApp } from "./app.js";
import { closeRedis } from "./infrastructure/redis/client.js";
import { logger } from "./infrastructure/logger/logger.js";

const app = await startApp();
logger.info("Ravolo game server ready");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  try {
    app.close();
  } catch (e) {
    logger.warn({ err: e }, "app.close failed");
  }
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
