import { redis } from "../economy/redis.js";
import { executeTransfer } from "../economy/ledger.js";
import { FarmingEngine } from "../game/farming.js";

// List of possible ultra-rare black market items with their discounted prices
const TRADER_POOL = [
  { id: "golden_egg", price: 1000, qty_available: 5 },
  { id: "rich_milk", price: 1500, qty_available: 3 },
  { id: "royal_jelly", price: 2500, qty_available: 2 },
  { id: "truffle", price: 3000, qty_available: 2 },
  { id: "medicine", price: 200, qty_available: 10 },
  { id: "incubator_blueprint", price: 10000, qty_available: 1 },
];

export class BlackMarketTrader {
  /**
   * Called periodically (e.g. every minute by the game clock) to check if the trader should spawn,
   * or if an active trader has expired.
   */
  static async tick(nowMs: number): Promise<{
    arrived: boolean;
    departed: boolean;
    items?: any;
    expiresAt?: number;
  }> {
    const isActive = await redis.get("trader:active");

    if (isActive === "1") {
      const expiresAt = await redis.get("trader:expires_at");
      if (expiresAt && nowMs >= parseInt(expiresAt, 10)) {
        await redis.del([
          "trader:active",
          "trader:items",
          "trader:expires_at",
          "trader:next_spawn",
        ]);
        return { arrived: false, departed: true };
      }
      return { arrived: false, departed: false };
    }

    const nextSpawnStr = await redis.get("trader:next_spawn");

    if (!nextSpawnStr) {
      const nextSpawnMs =
        nowMs + (Math.floor(Math.random() * 60) + 30) * 60 * 1000;
      await redis.set("trader:next_spawn", nextSpawnMs.toString());
      return { arrived: false, departed: false };
    }

    const nextSpawnMs = parseInt(nextSpawnStr, 10);
    if (nowMs >= nextSpawnMs) {
      const expiresAt = nowMs + 10 * 60 * 1000;

      const shuffled = [...TRADER_POOL].sort(() => 0.5 - Math.random());
      const selectedItems = shuffled.slice(0, 3);

      await redis.mSet({
        "trader:active": "1",
        "trader:expires_at": expiresAt.toString(),
        "trader:items": JSON.stringify(selectedItems),
      });

      // We also delete next_spawn so it gets re-rolled after trader departs
      await redis.del("trader:next_spawn");

      return {
        arrived: true,
        departed: false,
        items: selectedItems,
        expiresAt,
      };
    }

    return { arrived: false, departed: false };
  }

  /**
   * Action for a player to buy an item from the black market
   */
  static async buyItem(
    profileId: string,
    itemId: string,
    qty: number,
  ): Promise<{ cost: number }> {
    if (qty <= 0) throw new Error("Invalid quantity");

    const isActive = await redis.get("trader:active");
    if (isActive !== "1")
      throw new Error("The Black Market Trader is not currently here");

    const itemsRaw = await redis.get("trader:items");
    if (!itemsRaw) throw new Error("Trader has no items");

    const items: Array<{ id: string; price: number; qty_available: number }> =
      JSON.parse(itemsRaw);

    const itemIndex = items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) throw new Error("Trader does not sell this item");

    const item = items[itemIndex];
    if (item.qty_available < qty)
      throw new Error(
        `Trader only has ${item.qty_available} of this item left`,
      );

    const totalCost = item.price * qty;

    // Debit player
    const success = await executeTransfer({
      fromType: "player",
      fromId: profileId,
      toType: "treasury",
      toId: "treasury-singleton",
      amount: totalCost,
      reason: "black_market_purchase",
      metadata: { itemId, qty },
    });

    if (!success) throw new Error("Insufficient funds");

    // Deduct stock
    items[itemIndex].qty_available -= qty;
    if (items[itemIndex].qty_available <= 0) {
      items.splice(itemIndex, 1);
    }

    await redis.set("trader:items", JSON.stringify(items));

    // Give item to player
    await FarmingEngine.incrementInventory(profileId, itemId, qty);

    return { cost: totalCost };
  }

  static async getActiveState() {
    const isActive = await redis.get("trader:active");
    if (isActive !== "1") return null;

    const expiresAt = await redis.get("trader:expires_at");
    const itemsRaw = await redis.get("trader:items");

    return {
      expiresAt: expiresAt ? parseInt(expiresAt, 10) : 0,
      items: itemsRaw ? JSON.parse(itemsRaw) : [],
    };
  }
}
