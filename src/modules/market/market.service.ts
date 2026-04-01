import type { Redis } from "ioredis";
import { serverNowMs } from "../../shared/utils/time.js";
import { buyCostGold, sellPayoutGold, toSafeGold } from "../../shared/utils/gold.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  buyIdempotencyKey,
  inventoryKey,
  sellIdempotencyKey,
  treasuryBuyPricesKey,
  treasurySellPricesKey,
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
  buyBasePriceMicro,
  PRICED_ITEM_IDS,
  resolveBaseMicro,
} from "./market.catalog.js";
import { treasuryTradeSchema } from "./market.validator.js";
import type { BuyResult, SellResult, MarketStatus } from "./market.types.js";
import { OnboardingService } from "../onboarding/onboarding.service.js";
import { redisTreasuryBuy, redisTreasurySell } from "../../infrastructure/redis/commands.js";
import { IDEMPOTENCY_TTL_SEC, SPREAD_BUY_FACTOR, SPREAD_SELL_FACTOR } from "../../config/constants.js";
import { getEventMultiplier, getActiveEvent } from "../ai-events/event.service.js";
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

  /** Returns the dynamic buy micro-price from Redis, falling back to the base reference. */
  private async buyPriceMicroFor(item: string): Promise<number> {
    const raw = await this.redis.hget(treasuryBuyPricesKey(), item);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    // Fallback: apply spread to the base buy price
    return Math.max(1, Math.round(buyBasePriceMicro(item) * SPREAD_BUY_FACTOR));
  }

  /** Returns the dynamic sell micro-price from Redis, falling back to the base reference. */
  private async sellPriceMicroFor(item: string): Promise<number> {
    const raw = await this.redis.hget(treasurySellPricesKey(), item);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    // Fallback: apply spread to the base sell price
    return Math.max(1, Math.round(produceBasePriceMicro(item) * SPREAD_SELL_FACTOR));
  }

  async getAllPrices(): Promise<MarketStatus> {
    const [rawBuy, rawSell] = await Promise.all([
      this.redis.hgetall(treasuryBuyPricesKey()),
      this.redis.hgetall(treasurySellPricesKey()),
    ]);
    const activeEvent = await getActiveEvent(this.redis);
    const now = Date.now();

    const status: MarketStatus = {};

    for (const id of PRICED_ITEM_IDS) {
      // Resolve buy micro-price
      let buyMicro = Number(rawBuy[id]) || 0;
      if (buyMicro < 1) {
        buyMicro = Math.max(1, Math.round(buyBasePriceMicro(id) * SPREAD_BUY_FACTOR));
      }

      // Resolve sell micro-price
      let sellMicro = Number(rawSell[id]) || 0;
      if (sellMicro < 1) {
        sellMicro = Math.max(1, Math.round(produceBasePriceMicro(id) * SPREAD_SELL_FACTOR));
      }

      // Apply AI event multiplier to both sides
      if (
        activeEvent &&
        now <= activeEvent.expiresAtMs &&
        activeEvent.affectedItems.includes(id)
      ) {
        buyMicro = Math.max(1, Math.round(buyMicro * activeEvent.multiplier));
        sellMicro = Math.max(1, Math.round(sellMicro * activeEvent.multiplier));
      }

      // Hard safety: buy must always be strictly greater than sell
      if (buyMicro <= sellMicro) {
        buyMicro = Math.max(sellMicro + 1, Math.round(sellMicro * 1.3));
      }

      const canBuy = isBuyableItem(id);
      const canSell = isTreasurySellable(id);

      status[id] = {
        buy: canBuy ? buyMicro : null,
        sell: canSell ? sellMicro : null,
      };
    }

    return status;
  }

  async getUserGold(userId: string): Promise<number> {
    // Wallet stores whole gold units — the Lua scripts use HINCRBY with whole gold values.
    const raw = await this.redis.hget(walletKey(userId), "gold");
    return Math.max(0, Math.floor(Number(raw) || 0));
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

    // Use the SELL price (what the CBN pays the player — lower side of spread)
    let priceMicro = await this.sellPriceMicroFor(item);

    // Apply AI event multiplier — floor to integer; Lua HINCRBY requires integers
    const eventMul = await getEventMultiplier(this.redis, item);
    priceMicro = Math.max(1, Math.floor(priceMicro * eventMul));

    let goldPaid = sellPayoutGold(priceMicro, quantity);

    // Apply wash trade tax penalty if caught
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      const penalized = await this.redis.get(syndicateTaxPenaltyKey(sid));
      if (penalized === "1") {
        goldPaid = toSafeGold(goldPaid * 0.8); // 20% tax cut, always integer
      }
    }

    // Hard clamp: must be a non-negative integer before it reaches Lua
    goldPaid = toSafeGold(goldPaid);

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

    // Use the BUY price (what the player pays the CBN — higher side of spread)
    let priceMicro = await this.buyPriceMicroFor(item);

    // Apply AI event multiplier — floor to integer; Lua HINCRBY requires integers
    const eventMul = await getEventMultiplier(this.redis, item);
    priceMicro = Math.max(1, Math.floor(priceMicro * eventMul));

    let goldSpent = buyCostGold(priceMicro, quantity);

    // Apply wash trade tax penalty if caught
    const sid = await this.redis.get(userSyndicateIdKey(userId));
    if (sid) {
      const penalized = await this.redis.get(syndicateTaxPenaltyKey(sid));
      if (penalized === "1") {
        goldSpent = toSafeGold(Math.ceil(goldSpent * 1.2)); // 20% increased cost, always integer
      }
    }

    // Hard clamp: must be a non-negative integer before it reaches Lua
    goldSpent = toSafeGold(goldSpent);

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
