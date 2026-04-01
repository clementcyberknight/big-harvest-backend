import type { Redis } from "ioredis";
import {
  MAX_PLOTS_PER_PLAYER,
  PLOT_PURCHASE_BASE_GOLD,
  PLOT_PURCHASE_STEP_GOLD,
  STARTER_PLOT_IDS,
} from "../../config/constants.js";
import { LOAN_PLOT_COLLATERAL_GOLD } from "../../config/loan.constants.js";
import { AppError } from "../../shared/errors/appError.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { FarmRepository } from "./farm.repository.js";
import type {
  BuyPlotCommand,
  BuyPlotResult,
  GameStatusPlotsData,
} from "./farm.types.js";
import { buyPlotSchema } from "./farm.validator.js";

export function getGameStatusPlotsData(): GameStatusPlotsData {
  return {
    starterPlots: STARTER_PLOT_IDS.length,
    starterPlotIds: [...STARTER_PLOT_IDS],
    purchasable: true,
    maxPlots: MAX_PLOTS_PER_PLAYER,
    purchaseBaseGold: PLOT_PURCHASE_BASE_GOLD,
    purchaseStepGold: PLOT_PURCHASE_STEP_GOLD,
    pricingFormula:
      "nextPlotGold = purchaseBaseGold + ((nextPlotId - starterPlots) * purchaseStepGold)",
    loanCollateralValueGold: LOAN_PLOT_COLLATERAL_GOLD,
    note:
      "Plots are bought sequentially after the starter grant. Buying land immediately adds an empty plot to the farm.",
  };
}

export class FarmService {
  constructor(
    private readonly redis: Redis,
    private readonly farmRepo = new FarmRepository(),
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async buyPlot(userId: string, raw: unknown): Promise<BuyPlotResult> {
    const parsed = buyPlotSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid buy plot payload", {
        issues: parsed.error.issues,
      });
    }

    const cmd = parsed.data as BuyPlotCommand;

    await this.onboarding.ensureOnboarded(userId);

    try {
      return await this.farmRepo.buyPlotAtomic(this.redis, userId, {
        requestId: cmd.requestId,
        starterPlotCount: STARTER_PLOT_IDS.length,
        maxPlots: MAX_PLOTS_PER_PLAYER,
        baseGold: PLOT_PURCHASE_BASE_GOLD,
        stepGold: PLOT_PURCHASE_STEP_GOLD,
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("ERR_INSUFFICIENT_GOLD")) {
        throw new AppError(
          "INSUFFICIENT_GOLD",
          "Not enough gold to buy the next plot",
        );
      }
      if (e instanceof Error && e.message.includes("ERR_MAX_PLOTS")) {
        throw new AppError(
          "MAX_PLOTS_REACHED",
          "Maximum plot count reached",
          { maxPlots: MAX_PLOTS_PER_PLAYER },
        );
      }
      throw e;
    }
  }
}
