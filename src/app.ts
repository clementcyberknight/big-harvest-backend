import { MAX_TREASURY_GOLD_SUPPLY } from "./config/constants.js";
import { env } from "./config/env.js";
import { getRedis } from "./infrastructure/redis/client.js";
import { loadRedisScripts } from "./infrastructure/redis/commands.js";
import { treasuryReserveKey } from "./infrastructure/redis/keys.js";
import { logger } from "./infrastructure/logger/logger.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { AnimalService } from "./modules/animal/animal.service.js";
import { CraftingService } from "./modules/crafting/crafting.service.js";
import { FarmService } from "./modules/farm/farm.service.js";
import { OnboardingService } from "./modules/onboarding/onboarding.service.js";
import { HarvestingService } from "./modules/harvesting/harvesting.service.js";
import { LoanService } from "./modules/loan/loan.service.js";
import { MarketService } from "./modules/market/market.service.js";
import { PlantingService } from "./modules/planting/planting.service.js";
import { ProfileService } from "./modules/profile/profile.service.js";
import { SyndicateService } from "./modules/syndicate/syndicate.service.js";
import { UserActionService } from "./modules/user-actions/userAction.service.js";
import {
  broadcastToAll,
  broadcastGameStatus,
  createWsApp,
  listenGameWs,
  type ListenToken,
  type WsAppContext,
} from "./transport/websocket/ws.server.js";
import { runPricingTick } from "./workers/pricing.worker.js";
import { setAiEventBroadcaster } from "./workers/aiEvent.worker.js";
import { LeaderboardService } from "./modules/leaderboard/leaderboard.service.js";
import { SchedulerService } from "./modules/scheduler/scheduler.service.js";
import {
  flushUserActionsQueueToSupabase,
  startUserActionsFlushWorker,
} from "./workers/userActionsFlush.worker.js";
import { us_listen_socket_close } from "uWebSockets.js";

export type AppInstance = {
  ctx: WsAppContext;
  listenToken: ListenToken;
  /** Sync teardown (listeners, uWS). Prefer {@link disposeAsync} for clean shutdown. */
  close: () => void;
  /** Stops background workers, closes sockets; then caller should flush user_actions and close Redis. */
  disposeAsync: () => Promise<void>;
};

export async function startApp(): Promise<AppInstance> {
  const redis = getRedis();

  await redis.set(treasuryReserveKey(), String(MAX_TREASURY_GOLD_SUPPLY), "NX");

  await loadRedisScripts(redis);
  await runPricingTick(redis);

  const market = new MarketService(redis);
  const farm = new FarmService(redis);
  const loan = new LoanService(redis);
  const animals = new AnimalService(redis);
  const crafting = new CraftingService(redis);
  const profile = new ProfileService();
  const onboarding = new OnboardingService(redis);
  const auth = new AuthService(redis, profile, onboarding);
  const userActions = new UserActionService(redis);
  const stopUserActionsWorker = startUserActionsFlushWorker(redis);
  const syndicates = new SyndicateService(redis);
  const leaderboards = new LeaderboardService(redis);

  const ctx: WsAppContext = {
    redis,
    planting: new PlantingService(redis),
    farm,
    harvesting: new HarvestingService(redis),
    market,
    loan,
    animals,
    crafting,
    userActions,
    syndicates,
    leaderboards,
    auth,
    profile,
  };

  const scheduler = new SchedulerService(redis, () => broadcastGameStatus(ctx));

  const uws = createWsApp(ctx);
  // Always bind to WS_PORT. Set this to match the "Internal Port" value in
  // Railway Public Networking. Do NOT rely on Railway's injected PORT variable.
  const listenPort = env.WS_PORT;
  logger.info({ port: listenPort, NODE_ENV: env.NODE_ENV }, "binding uWS server");
  const listenToken = await listenGameWs(uws, listenPort);

  // Start the centralized scheduler engine
  scheduler.startAll();

  // Set up AI event broadcaster to push to all connected WS clients
  setAiEventBroadcaster(async (event) => {
    broadcastToAll({ type: "AI_EVENT", data: event });
    await broadcastGameStatus(ctx);
  });

  logger.info({ port: listenPort }, "game services bound");

  return {
    ctx,
    listenToken,
    close: () => {
      scheduler.stopAll();
      us_listen_socket_close(listenToken as never);
      uws.close();
    },
    disposeAsync: async () => {
      scheduler.stopAll();
      await stopUserActionsWorker();
      us_listen_socket_close(listenToken as never);
      uws.close();
      await flushUserActionsQueueToSupabase(redis);
    },
  };
}
