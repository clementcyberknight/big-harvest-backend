import type { Redis } from "ioredis";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { getCropDefinition, harvestFieldForCrop, isCropId } from "../crop/crop.config.js";
import type { CropId } from "../crop/crop.config.js";
import { FarmRepository } from "../farm/farm.repository.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import type { PlantCommand, PlantResult } from "./planting.types.js";
import { plantCommandSchema } from "./planting.validator.js";
import { PlantingRepository } from "./planting.repository.js";

export class PlantingService {
  constructor(
    private readonly redis: Redis,
    private readonly farmRepo = new FarmRepository(),
    private readonly plantingRepo = new PlantingRepository(),
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async plant(userId: string, raw: unknown): Promise<PlantResult> {
    const parsed = plantCommandSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid plant payload", {
        issues: parsed.error.issues,
      });
    }
    const cmd = parsed.data as PlantCommand;

    if (!isCropId(cmd.cropId)) {
      throw new AppError("UNKNOWN_CROP", "Unknown crop", { cropId: cmd.cropId });
    }
    const cropId = cmd.cropId as CropId;
    const def = getCropDefinition(cropId);

    await this.onboarding.ensureOnboarded(userId);
    const owned = await this.farmRepo.isPlotOwned(this.redis, userId, cmd.plotId);
    if (!owned) {
      throw new AppError("PLOT_NOT_OWNED", "Plot not owned", { plotId: cmd.plotId });
    }

    const now = serverNowMs();
    const readyAt = now + def.growTimeSec * 1000;

    try {
      return await this.plantingRepo.plantAtomic(this.redis, userId, {
        plotId: cmd.plotId,
        cropId,
        requestId: cmd.requestId,
        plantedAtMs: now,
        readyAtMs: readyAt,
        outputQty: def.output,
        seedCost: def.seedCost,
        harvestItem: harvestFieldForCrop(cropId),
      });
    } catch (e) {
      if (e instanceof Error && (e as Error & { code?: string }).code === "PLOT_OCCUPIED") {
        throw new AppError("PLOT_OCCUPIED", "Plot already has a crop", {
          plotId: cmd.plotId,
        });
      }
      if (e instanceof Error && (e as Error & { code?: string }).code === "INSUFFICIENT_SEEDS") {
        throw new AppError("INSUFFICIENT_SEEDS", "Not enough seeds", {
          cropId,
          need: def.seedCost,
        });
      }
      throw e;
    }
  }
}
