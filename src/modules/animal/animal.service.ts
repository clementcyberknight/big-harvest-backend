import type { Redis } from "ioredis";
import { ANIMAL_FED_WINDOW_MS } from "../../config/animal.constants.js";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";
import {
  animalFeedIdempotencyKey,
  animalHarvestIdempotencyKey,
  animalStateKey,
  inventoryKey,
} from "../../infrastructure/redis/keys.js";
import { redisAnimalFeed, redisAnimalHarvest } from "../../infrastructure/redis/commands.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { getAnimalSpecies, isAnimalSpeciesId } from "./animal.config.js";
import { animalFeedSchema, animalHarvestSchema } from "./animal.validator.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export class AnimalService {
  constructor(
    private readonly redis: Redis,
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async feed(userId: string, raw: unknown) {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = animalFeedSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid animal feed payload", {
        issues: parsed.error.issues,
      });
    }
    const { species, requestId } = parsed.data;
    if (!isAnimalSpeciesId(species)) {
      throw new AppError("BAD_REQUEST", "Unknown species");
    }
    const def = getAnimalSpecies(species);
    const now = serverNowMs();
    const intervalMs = def.produceIntervalSec * 1000;

    try {
      return await redisAnimalFeed(
        this.redis,
        {
          invKey: inventoryKey(userId),
          stateKey: animalStateKey(userId),
          idempKey: animalFeedIdempotencyKey(userId, requestId),
        },
        {
          speciesKey: species,
          animalInvField: def.inventoryField,
          feedItem: def.feedItem,
          feedPerAnimal: def.feedPerAnimal,
          nowMs: now,
          produceIntervalMs: intervalMs,
          fedWindowMs: ANIMAL_FED_WINDOW_MS,
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_NO_ANIMALS")) {
        throw new AppError("NO_ANIMALS", "No animals of this type");
      }
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_FEED")) {
        throw new AppError("INSUFFICIENT_FEED", "Not enough feed in inventory", {
          need: def.feedItem,
        });
      }
      throw e;
    }
  }

  async harvest(userId: string, raw: unknown) {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = animalHarvestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid animal harvest payload", {
        issues: parsed.error.issues,
      });
    }
    const { species, requestId } = parsed.data;
    if (!isAnimalSpeciesId(species)) {
      throw new AppError("BAD_REQUEST", "Unknown species");
    }
    const def = getAnimalSpecies(species);
    const now = serverNowMs();
    const intervalMs = def.produceIntervalSec * 1000;

    try {
      return await redisAnimalHarvest(
        this.redis,
        {
          invKey: inventoryKey(userId),
          stateKey: animalStateKey(userId),
          idempKey: animalHarvestIdempotencyKey(userId, requestId),
        },
        {
          speciesKey: species,
          animalInvField: def.inventoryField,
          produceItem: def.produceItem,
          maxProduce: def.maxProducePerHarvest,
          produceIntervalMs: intervalMs,
          nowMs: now,
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_NOT_FED")) {
        throw new AppError("NOT_FED", "Animals need feed before production");
      }
      if (isReplyError(e) && e.message.includes("ERR_NOT_READY")) {
        throw new AppError("NOT_READY", "Produce not ready yet");
      }
      if (isReplyError(e) && e.message.includes("ERR_NO_ANIMALS")) {
        throw new AppError("NO_ANIMALS", "No animals of this type");
      }
      throw e;
    }
  }
}
