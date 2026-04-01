import { PRICE_MICRO_PER_GOLD } from "../../config/constants.js";
import {
  allPricedItemIds,
  REFERENCE_GOLD,
  isTreasurySellable,
} from "../economy/referencePrices.js";

export type BuyCatalogEntry = {
  inventoryField: string;
  minLevel: number;
  basePriceMicro: number;
};

/** Treasury shop: all items with a buy price (buy price from reference). */
export const BUY_CATALOG: Record<string, BuyCatalogEntry> = (() => {
  const out: Record<string, BuyCatalogEntry> = {};
  for (const [field, ref] of Object.entries(REFERENCE_GOLD)) {
    if (ref.buy > 0) {
      out[field] = {
        inventoryField: field,
        minLevel: 1,
        basePriceMicro: Math.max(1, ref.buy * PRICE_MICRO_PER_GOLD),
      };
    }
  }
  return out;
})();

export function isBuyableItem(field: string): field is keyof typeof BUY_CATALOG {
  return field in BUY_CATALOG;
}

export function getBuyCatalogEntry(field: string): BuyCatalogEntry | undefined {
  return BUY_CATALOG[field];
}

export { isTreasurySellable };

/** Base sell micro-price: what the CBN pays the player per unit (baseline, before dynamic tick). */
export function produceBasePriceMicro(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (r && r.sell > 0) return Math.max(1, r.sell * PRICE_MICRO_PER_GOLD);
  return 1;
}

/** Base buy micro-price: what the player pays the CBN per unit (baseline, before dynamic tick). */
export function buyBasePriceMicro(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (r && r.buy > 0) return Math.max(1, r.buy * PRICE_MICRO_PER_GOLD);
  return 1;
}

export const PRICED_ITEM_IDS: string[] = allPricedItemIds();

/**
 * Returns the mid/base micro-price for an item (used by the pricing worker as the
 * starting point for demand/scarcity/volatility calculations).
 * For buyable items we anchor on the buy side; for sell-only items on the sell side.
 */
export function resolveBaseMicro(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (!r) return 1;
  // Mid = average of buy and sell base, giving the pricing worker a neutral anchor
  const buyMicro = r.buy * PRICE_MICRO_PER_GOLD;
  const sellMicro = r.sell * PRICE_MICRO_PER_GOLD;
  return Math.max(1, Math.round((buyMicro + sellMicro) / 2));
}
