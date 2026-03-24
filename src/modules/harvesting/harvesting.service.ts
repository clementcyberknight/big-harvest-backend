import type { Redis } from "ioredis";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { FarmRepository } from "../farm/farm.repository.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import type { HarvestCommand, HarvestResult } from "./harvesting.types.js";
import { harvestCommandSchema } from "./harvesting.validator.js";
import { HarvestingRepository } from "./harvesting.repository.js";

export class HarvestingService {
  constructor(
    private readonly redis: Redis,
    private readonly farmRepo = new FarmRepository(),
    private readonly harvestRepo = new HarvestingRepository(),
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async harvest(userId: string, raw: unknown): Promise<HarvestResult> {
    const parsed = harvestCommandSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid harvest payload", {
        issues: parsed.error.issues,
      });
    }
    const cmd = parsed.data as HarvestCommand;

    await this.onboarding.ensureOnboarded(userId);
    const owned = await this.farmRepo.isPlotOwned(this.redis, userId, cmd.plotId);
    if (!owned) {
      throw new AppError("PLOT_NOT_OWNED", "Plot not owned", { plotId: cmd.plotId });
    }

    const now = serverNowMs();

    try {
      return await this.harvestRepo.harvestAtomic(this.redis, userId, {
        plotId: cmd.plotId,
        requestId: cmd.requestId,
        nowMs: now,
      });
    } catch (e) {
      if (e instanceof Error && (e as Error & { code?: string }).code === "EMPTY_PLOT") {
        throw new AppError("EMPTY_PLOT", "Nothing planted on this plot", {
          plotId: cmd.plotId,
        });
      }
      if (e instanceof Error && (e as Error & { code?: string }).code === "NOT_READY") {
        throw new AppError("NOT_READY", "Crop is not ready yet", { plotId: cmd.plotId });
      }
      if (e instanceof Error && (e as Error & { code?: string }).code === "INVALID_OUTPUT") {
        throw new AppError("INVALID_OUTPUT", "Invalid crop output state", {
          plotId: cmd.plotId,
        });
      }
      throw e;
    }
  }
}
