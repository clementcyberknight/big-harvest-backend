import type { Redis } from "ioredis";
import { serverNowMs } from "../../shared/utils/time.js";
import { buyCostGold, sellPayoutGold } from "../../shared/utils/gold.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  buyIdempotencyKey,
  inventoryKey,
  sellIdempotencyKey,
  treasuryPricesKey,
  treasuryReserveKey,
  treasuryBuyFlowKey,
  treasurySellFlowKey,
  treasuryTradesStreamKey,
  userLevelKey,
  walletKey,
} from "../../infrastructure/redis/keys.js";
import {
  getBuyCatalogEntry,
  isBuyableItem,
  isTreasurySellable,
  produceBasePriceMicro,
} from "./market.catalog.js";
import { treasuryTradeSchema } from "./market.validator.js";
import type { BuyResult, SellResult } from "./market.types.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { redisTreasuryBuy, redisTreasurySell } from "../../infrastructure/redis/commands.js";
import { IDEMPOTENCY_TTL_SEC } from "../../config/constants.js";
import { getEventMultiplier } from "../ai-events/event.service.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { userSyndicateIdKey, syndicateTaxPenaltyKey } from "../../infrastructure/redis/keys.js";

function isReplyError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

export class MarketService {
  constructor(
    private readonly redis: Redis,
    private readonly onboarding = new OnboardingService(redis),
  ) {}

  private async userLevel(userId: string): Promise<number> {
    const v = await this.redis.hget(userLevelKey(userId), "level");
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }

  private async priceMicroFor(item: string): Promise<number> {
    const raw = await this.redis.hget(treasuryPricesKey(), item);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 0;
  }

  async getAllPrices(): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(treasuryPricesKey());
    const prices: Record<string, number> = {};
    for (const [item, price] of Object.entries(raw)) {
      prices[item] = Number(price);
    }
    return prices;
  }

  async getUserGold(userId: string): Promise<number> {
    const gold = await this.redis.get(walletKey(userId));
    return Number(gold) || 0;
  }

  async getUserInventory(userId: string): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(inventoryKey(userId));
    const inventory: Record<string, number> = {};
    for (const [item, qty] of Object.entries(raw)) {
      inventory[item] = Number(qty);
    }
    return inventory;
  }

  async sell(userId: string, raw: unknown): Promise<SellResult> {
    await this.onboarding.ensureOnboarded(userId);

    const parsed = treasuryTradeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid sell payload", {
        issues: parsed.error.issues,
      });
    }
    const { item, quantity, requestId } = parsed.data;

    if (!isTreasurySellable(item)) {
      throw new AppError("UNKNOWN_ITEM", "Item cannot be sold to treasury", { item });
    }

    let priceMicro = await this.priceMicroFor(item);
    if (priceMicro < 1) {
      priceMicro = produceBasePriceMicro(item);
    }

    // Apply AI event multiplier
    const eventMul = await getEventMultiplier(this.redis, item);
    priceMicro = Math.max(1, Math.round(priceMicro * eventMul));

    let goldPaid = sellPayoutGold(priceMicro, quantity);
    
    // Apply wash trade tax penalty if caught
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      const penalized = await this.redis.get(syndicateTaxPenaltyKey(sid));
      if (penalized === "1") {
        goldPaid = Math.floor(goldPaid * 0.8); // 20% tax cut
      }
    }

    if (goldPaid < 0) {
      throw new AppError("BAD_REQUEST", "Invalid settlement", { item, quantity });
    }

    const keys = {
      invKey: inventoryKey(userId),
      walletKey: walletKey(userId),
      idempKey: sellIdempotencyKey(userId, requestId),
      reserveKey: treasuryReserveKey(),
      sellFlowKey: treasurySellFlowKey(),
      streamKey: treasuryTradesStreamKey(),
    };

    try {
      await redisTreasurySell(this.redis, keys, {
        item,
        quantity,
        goldPayout: goldPaid,
        idempTtlSec: IDEMPOTENCY_TTL_SEC,
        streamEnable: true,
        userId,
        tsMs: serverNowMs(),
      });
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_INV")) {
        throw new AppError("INSUFFICIENT_INV", "Not enough inventory", { item, quantity });
      }
      if (isReplyError(e) && e.message.includes("ERR_TREASURY_DEPLETED")) {
        throw new AppError("TREASURY_DEPLETED", "Treasury cannot settle this sale", {
          item,
        });
      }
      throw e;
    }

    return { item, quantity, goldPaid, priceMicro };
  }

  async buy(userId: string, raw: unknown): Promise<BuyResult> {
    await this.onboarding.ensureOnboarded(userId);

    const parsed = treasuryTradeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("BAD_REQUEST", "Invalid buy payload", {
        issues: parsed.error.issues,
      });
    }
    const { item, quantity, requestId } = parsed.data;

    if (!isBuyableItem(item)) {
      throw new AppError("UNKNOWN_ITEM", "Item not sold by treasury", { item });
    }

    const entry = getBuyCatalogEntry(item)!;
    const level = await this.userLevel(userId);
    if (level < entry.minLevel) {
      throw new AppError("ITEM_LOCKED", "Level too low for this item", {
        item,
        need: entry.minLevel,
        have: level,
      });
    }

    let priceMicro = await this.priceMicroFor(item);
    if (priceMicro < 1) priceMicro = entry.basePriceMicro;

    // Apply AI event multiplier
    const eventMul = await getEventMultiplier(this.redis, item);
    priceMicro = Math.max(1, Math.round(priceMicro * eventMul));

    let goldSpent = buyCostGold(priceMicro, quantity);

    // Apply wash trade tax penalty if caught
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      const penalized = await this.redis.get(syndicateTaxPenaltyKey(sid));
      if (penalized === "1") {
        goldSpent = Math.floor(goldSpent * 1.2); // 20% increased cost
      }
    }

    if (goldSpent < 0) {
      throw new AppError("BAD_REQUEST", "Invalid cost", { item, quantity });
    }

    const keys = {
      invKey: inventoryKey(userId),
      walletKey: walletKey(userId),
      idempKey: buyIdempotencyKey(userId, requestId),
      reserveKey: treasuryReserveKey(),
      buyFlowKey: treasuryBuyFlowKey(),
      streamKey: treasuryTradesStreamKey(),
    };

    try {
      await redisTreasuryBuy(this.redis, keys, {
        item,
        quantity,
        goldCost: goldSpent,
        idempTtlSec: IDEMPOTENCY_TTL_SEC,
        streamEnable: true,
        userId,
        tsMs: serverNowMs(),
      });
    } catch (e) {
      if (isReplyError(e) && e.message.includes("ERR_INSUFFICIENT_GOLD")) {
        throw new AppError("INSUFFICIENT_GOLD", "Not enough gold", {
          item,
          need: goldSpent,
        });
      }
      throw e;
    }

    return { item, quantity, goldSpent, priceMicro };
  }
}
