/**
 * Canonical buy/sell prices in whole gold (integers).
 * - Seeds: `buy` = shop packet price; `sell` mirrors buy (seeds are not “sold back” at a spread here).
 * - Produce / outputs: `sell` = treasury-style disposal value; `buy` matches `sell` unless a separate bid exists.
 * Collateral uses `unitCollateralGold()` (prefers `sell`, else `buy`).
 */

export type RefPrice = { buy: number; sell: number };

function p(buy: number, sell: number): RefPrice {
  const b = Math.max(0, Math.floor(buy));
  const s = Math.max(0, Math.floor(sell));
  return { buy: b, sell: s > 0 ? s : b };
}

export const REFERENCE_GOLD: Record<string, RefPrice> = {
  "seed:wheat": p(1, 1),
  "seed:corn": p(2, 2),
  "seed:rice": p(2, 2),
  "seed:vanilla": p(5, 5),
  "seed:tomato": p(2, 2),
  "seed:tea": p(3, 3),
  "seed:sunflower": p(3, 3),
  "seed:sugarcane": p(2, 2),
  "seed:strawberry": p(3, 3),
  "seed:soybean": p(3, 3),
  "seed:sapling": p(4, 4),
  "seed:potato": p(2, 2),
  "seed:pepper": p(2, 2),
  "seed:onion": p(2, 2),
  "seed:oat": p(2, 2),
  "seed:saffron": p(6, 6),
  "seed:mud_pit": p(1, 1),
  "seed:lavender": p(3, 3),
  "seed:grapes": p(3, 3),
  "seed:cotton": p(3, 3),
  "seed:coffee": p(5, 5),
  "seed:chili": p(3, 3),
  "seed:carrot": p(2, 2),
  "seed:cacao": p(5, 5),

  wheat: p(2, 2),
  corn: p(4, 4),
  rice: p(4, 4),
  vanilla_pods: p(8, 8),
  tomato: p(4, 4),
  tea_leaves: p(6, 6),
  sunflower_seeds: p(6, 6),
  sugarcane: p(5, 5),
  strawberry: p(6, 6),
  soybean: p(6, 6),
  sapling: p(8, 8),
  potato: p(4, 4),
  pepper: p(4, 4),
  onion: p(4, 4),
  oat: p(4, 4),
  saffron: p(12, 12),
  mud: p(2, 2),
  lavender: p(6, 6),
  grape: p(6, 6),
  cotton: p(6, 6),
  coffee_beans: p(10, 10),
  chili: p(6, 6),
  carrot: p(4, 4),
  cocoa_pods: p(10, 10),
  sugar: p(4, 8),

  "animal:chicken": p(5, 10),
  "animal:sheep": p(8, 15),
  "animal:cow": p(10, 20),
  "animal:goat": p(9, 18),
  "animal:pig": p(10, 20),
  "animal:silkworm": p(12, 25),
  "animal:bee": p(8, 16),

  egg: p(10, 10),
  wool: p(15, 15),
  milk: p(20, 20),
  pork: p(20, 20),
  silk: p(25, 25),
  honey: p(16, 16),
  beef: p(20, 20),
  goat_meat: p(18, 18),
  chicken_meat: p(10, 10),

  "craft:flour": p(5, 5),
  "craft:cake": p(20, 20),
  "craft:chocolate": p(25, 25),
  "craft:coffee": p(15, 15),
  "craft:cheese": p(20, 20),
  "craft:butter": p(18, 18),
  "craft:jam": p(18, 18),
  "craft:oil": p(15, 15),
  "craft:cloth": p(20, 20),
  "craft:wine": p(25, 25),

  "tool:bakery": p(35, 35),
  "tool:mill": p(20, 20),
  "tool:slaughter_house": p(50, 50),
  "tool:cheese_factory": p(40, 40),
  "tool:butter_churn": p(30, 30),
  "tool:winery": p(60, 60),
  "tool:oil_press": p(25, 25),
  "tool:chocolate_processor": p(50, 50),
  "tool:jam_station": p(30, 30),
};

const refKeys = new Set(Object.keys(REFERENCE_GOLD));

export function hasReferencePrice(itemId: string): boolean {
  return refKeys.has(itemId);
}

export function unitCollateralGold(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (!r) return 0;
  if (r.sell > 0) return r.sell;
  return r.buy;
}

export function allPricedItemIds(): string[] {
  return Object.keys(REFERENCE_GOLD);
}

/** Treasury buys these. All items with a sell price > 0 are sellable. */
export function isTreasurySellable(itemId: string): boolean {
  const r = REFERENCE_GOLD[itemId];
  return !!(r && r.sell > 0);
}
