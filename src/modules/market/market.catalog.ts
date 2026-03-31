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

export function produceBasePriceMicro(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (r && r.sell > 0) return Math.max(1, r.sell * PRICE_MICRO_PER_GOLD);
  return 1;
}

export const PRICED_ITEM_IDS: string[] = allPricedItemIds();

export function resolveBaseMicro(itemId: string): number {
  const b = getBuyCatalogEntry(itemId);
  if (b) return b.basePriceMicro;
  return produceBasePriceMicro(itemId);
}
