import type { Redis } from "ioredis";
import {
  STARTER_GOLD,
  STARTER_PLOT_IDS,
  STARTER_WHEAT_SEEDS,
} from "../../config/constants.js";
import {
  accountInitKey,
  inventoryKey,
  ownedPlotsKey,
  seedInventoryField,
  treasuryReserveKey,
  walletKey,
} from "../../infrastructure/redis/keys.js";
import { redisOnboard } from "../../infrastructure/redis/commands.js";
import { AppError } from "../../shared/errors/appError.js";

export class OnboardingService {
  constructor(private readonly redis: Redis) {}

  /**
   * Idempotent: creates account row in Redis or no-ops. Must run before farm/market use.
   */
  async ensureOnboarded(userId: string): Promise<void> {
    try {
      const res = await redisOnboard(
        this.redis,
        {
          accountInitKey: accountInitKey(userId),
          walletKey: walletKey(userId),
          invKey: inventoryKey(userId),
          plotsKey: ownedPlotsKey(userId),
          reserveKey: treasuryReserveKey(),
        },
        {
          starterGold: STARTER_GOLD,
          seedField: seedInventoryField("wheat"),
          seedCount: STARTER_WHEAT_SEEDS,
          plotCsv: STARTER_PLOT_IDS.join(","),
        },
      );
      if (res === "SKIP" || res === "OK") return;
      throw new Error(`Unexpected onboard: ${res}`);
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_TREASURY_DEPLETED")) {
        throw new AppError(
          "TREASURY_DEPLETED",
          "Treasury cannot fund starter grant",
        );
      }
      throw e;
    }
  }
}

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}
