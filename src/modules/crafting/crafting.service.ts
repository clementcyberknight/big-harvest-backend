import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";
import {
  craftClaimIdempotencyKey,
  craftPendingKey,
  craftStartIdempotencyKey,
  inventoryKey,
} from "../../infrastructure/redis/keys.js";
import { redisCraftClaim, redisCraftStart } from "../../infrastructure/redis/commands.js";
import { hasReferencePrice } from "../economy/referencePrices.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { AppError } from "../../shared/errors/appError.js";
import { serverNowMs } from "../../shared/utils/time.js";
import { getCraftRecipe, isCraftRecipeId } from "./crafting.recipes.js";
import { craftClaimSchema, craftStartSchema } from "./crafting.validator.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

function ingredientSpec(recipe: ReturnType<typeof getCraftRecipe>): string {
  return Object.entries(recipe.ingredients)
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

export class CraftingService {
  constructor(
    private readonly redis: Redis,
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  async start(userId: string, raw: unknown) {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = craftStartSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid craft start payload", {
        issues: parsed.error.issues,
      });
    }
    const { recipeId, requestId } = parsed.data;
    if (!isCraftRecipeId(recipeId)) {
      throw new AppError("UNKNOWN_RECIPE", "Unknown recipe");
    }
    const recipe = getCraftRecipe(recipeId);
    for (const item of Object.keys(recipe.ingredients)) {
      if (!hasReferencePrice(item)) {
        throw new AppError("UNKNOWN_ITEM", "Unknown ingredient", { item });
      }
    }
    if (!hasReferencePrice(recipe.toolField)) {
      throw new AppError("UNKNOWN_ITEM", "Unknown tool", { tool: recipe.toolField });
    }

    const pendingId = randomUUID();
    const now = serverNowMs();
    const readyAtMs = now + recipe.craftTimeSec * 1000;
    const spec = ingredientSpec(recipe);

    try {
      return await redisCraftStart(
        this.redis,
        {
          invKey: inventoryKey(userId),
          pendingKey: craftPendingKey(userId),
          idempKey: craftStartIdempotencyKey(userId, requestId),
        },
        {
          pendingId,
          toolField: recipe.toolField,
          toolMin: recipe.toolMin,
          ingredientSpec: spec,
          readyAtMs,
          outputItem: recipe.outputItem,
          outputQty: recipe.outputQty,
          idempTtlSec: IDEMPOTENCY_TTL_SEC,
        },
      );
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_MISSING_TOOL")) {
        throw new AppError("MISSING_TOOL", "Required tool not in inventory", {
          tool: recipe.toolField,
        });
      }
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_INV")) {
        throw new AppError("INSUFFICIENT_INV", "Not enough ingredients");
      }
      if (isReplyError(e) && e.message.includes("ERR_BAD_SPEC")) {
        throw new AppError("BAD_REQUEST", "Invalid craft specification");
      }
      throw e;
    }
  }

  async claim(userId: string, raw: unknown) {
    await this.onboarding.ensureOnboarded(userId);
    const parsed = craftClaimSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid craft claim payload", {
        issues: parsed.error.issues,
      });
    }
    const { pendingId, requestId } = parsed.data;
    const now = serverNowMs();

    try {
      return await redisCraftClaim(
        this.redis,
        {
          invKey: inventoryKey(userId),
          pendingKey: craftPendingKey(userId),
          idempKey: craftClaimIdempotencyKey(userId, requestId),
        },
        { pendingId, nowMs: now, idempTtlSec: IDEMPOTENCY_TTL_SEC },
      );
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_NO_CRAFT")) {
        throw new AppError("NO_CRAFT", "No matching pending craft");
      }
      if (isReplyError(e) && e.message.includes("ERR_NOT_READY")) {
        throw new AppError("NOT_READY", "Craft still in progress");
      }
      if (isReplyError(e) && e.message.includes("ERR_BAD_PENDING")) {
        throw new AppError("INTERNAL", "Corrupt craft record");
      }
      throw e;
    }
  }
}
