import { MAX_TREASURY_GOLD_SUPPLY } from "./config/constants.js";
import { env } from "./config/env.js";
import { getRedis } from "./infrastructure/redis/client.js";
import { loadRedisScripts } from "./infrastructure/redis/commands.js";
import { treasuryReserveKey } from "./infrastructure/redis/keys.js";
import { logger } from "./infrastructure/logger/logger.js";
import { AnimalService } from "./modules/animal/animal.service.js";
import { CraftingService } from "./modules/crafting/crafting.service.js";
import { HarvestingService } from "./modules/harvesting/harvesting.service.js";
import { LoanService } from "./modules/loan/loan.service.js";
import { MarketService } from "./modules/market/market.service.js";
import { PlantingService } from "./modules/planting/planting.service.js";
import type { WsGameContext } from "./transport/websocket/ws.router.js";
import { createWsApp, listenGameWs, type ListenToken } from "./transport/websocket/ws.server.js";
import { runPricingTick, startPricingLoop } from "./workers/pricing.worker.js";
import { us_listen_socket_close } from "uWebSockets.js";

export type AppInstance = {
  ctx: WsGameContext;
  listenToken: ListenToken;
  close: () => void;
};

export async function startApp(): Promise<AppInstance> {
  const redis = getRedis();

  await redis.set(treasuryReserveKey(), String(MAX_TREASURY_GOLD_SUPPLY), "NX");

  await loadRedisScripts(redis);
  await runPricingTick(redis);
  const stopPricing = startPricingLoop(redis);

  const market = new MarketService(redis);
  const loan = new LoanService(redis);
  const animals = new AnimalService(redis);
  const crafting = new CraftingService(redis);
  const ctx: WsGameContext = {
    planting: new PlantingService(redis),
    harvesting: new HarvestingService(redis),
    market,
    loan,
    animals,
    crafting,
  };

  const uws = createWsApp(ctx);
  const listenToken = await listenGameWs(uws, env.WS_PORT);
  logger.info({ port: env.WS_PORT }, "game services bound");

  return {
    ctx,
    listenToken,
    close: () => {
      stopPricing();
      us_listen_socket_close(listenToken as never);
      uws.close();
    },
  };
}
