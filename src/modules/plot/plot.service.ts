import { z } from "zod";
import type { Redis } from "ioredis";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { toSafeGold } from "../../shared/utils/gold.js";
import {
  walletKey,
  ownedPlotsKey,
  buyPlotIdempotencyKey,
  treasuryReserveKey,
} from "../../infrastructure/redis/keys.js";
import { redisBuyPlot } from "../../infrastructure/redis/commands.js";
import { IDEMPOTENCY_TTL_SEC, PLOT_DEED_TIERS, MAX_PLOTS_PER_USER } from "../../config/constants.js";
import { REFERENCE_GOLD } from "../economy/referencePrices.js";
import { PRICE_MICRO_PER_GOLD, SPREAD_BUY_FACTOR } from "../../config/constants.js";
import {
  treasuryBuyPricesKey,
  userSyndicateIdKey,
  syndicateTaxPenaltyKey,
} from "../../infrastructure/redis/keys.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export const buyPlotSchema = z.object({
  deedType: z.enum(["plot:deed_t1", "plot:deed_t2", "plot:deed_t3"]),
  requestId: z.string().min(8).max(128),
});

export type BuyPlotInput = z.infer<typeof buyPlotSchema>;
export type BuyPlotResult = { newPlotId: number; goldSpent: number; deedType: string };

export class PlotService {
  constructor(
    private readonly redis: Redis,
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  /** Returns the dynamic buy micro-price for a deed from Redis, falling back to the reference. */
  private async deedBuyPriceMicro(deedType: string): Promise<number> {
    const raw = await this.redis.hget(treasuryBuyPricesKey(), deedType);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    // Fallback: base reference × spread factor
    const ref = REFERENCE_GOLD[deedType];
    if (ref && ref.buy > 0) {
      return Math.max(1, Math.round(ref.buy * PRICE_MICRO_PER_GOLD * SPREAD_BUY_FACTOR));
    }
    return 1;
  }

  async buyPlot(userId: string, raw: unknown): Promise<BuyPlotResult> {
    await this.onboarding.ensureOnboarded(userId);

    const parsed = buyPlotSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid buy_plot payload", {
        issues: parsed.error.issues,
      });
    }
    const { deedType, requestId } = parsed.data;

    const tierConfig = PLOT_DEED_TIERS[deedType];
    if (!tierConfig) {
      throw new AppError("UNKNOWN_ITEM", "Unknown plot deed type", { deedType });
    }

    // Get current plot count to enforce per-tier cap
    const currentPlotCount = await this.redis.scard(ownedPlotsKey(userId));
    if (currentPlotCount >= tierConfig.maxOwnedPlots) {
      throw new AppError("PLOT_CAP_REACHED", "You have reached the maximum plots for this deed tier", {
        deedType,
        maxOwnedPlots: tierConfig.maxOwnedPlots,
        currentPlots: currentPlotCount,
      });
    }

    // Hard ceiling
    if (currentPlotCount >= MAX_PLOTS_PER_USER) {
      throw new AppError("PLOT_CAP_REACHED", "Maximum total plots reached", {
        max: MAX_PLOTS_PER_USER,
        current: currentPlotCount,
      });
    }

    // Resolve deed price (dynamic from pricing worker or fallback)
    let priceMicro = await this.deedBuyPriceMicro(deedType);

    // Convert micro-price to whole gold (ceil to ensure the player always pays ≥ base)
    let goldSpent = toSafeGold(Math.ceil((priceMicro * 1) / PRICE_MICRO_PER_GOLD));

    // Apply wash trade tax penalty if applicable
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      const penalized = await this.redis.get(syndicateTaxPenaltyKey(sid));
      if (penalized === "1") {
        goldSpent = toSafeGold(Math.ceil(goldSpent * 1.2));
      }
    }

    if (goldSpent <= 0) {
      throw new AppError("BAD_REQUEST", "Invalid plot cost computed", { deedType });
    }

    try {
      const result = await redisBuyPlot(
        this.redis,
        {
          walletKey: walletKey(userId),
          plotsKey: ownedPlotsKey(userId),
          idempKey: buyPlotIdempotencyKey(userId, requestId),
          reserveKey: treasuryReserveKey(),
        },
        {
          goldCost: goldSpent,
          maxOwnedPlots: tierConfig.maxOwnedPlots,
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
          userId,
          tsMs: serverNowMs(),
        },
      );

      return { newPlotId: result.newPlotId, goldSpent: result.goldSpent, deedType };
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_GOLD")) {
        throw new AppError("INSUFFICIENT_GOLD", "Not enough gold to buy this plot", {
          deedType,
          need: goldSpent,
        });
      }
      if (isReplyError(e) && e.message.includes("ERR_PLOT_CAP_REACHED")) {
        throw new AppError("PLOT_CAP_REACHED", "Plot cap reached for this deed tier", {
          deedType,
          maxOwnedPlots: tierConfig.maxOwnedPlots,
        });
      }
      throw e;
    }
  }
}
