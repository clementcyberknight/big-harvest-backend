/**
 * Canonical buy/sell prices in whole gold (integers).
 *
 * IMPORTANT ECONOMIC RULE:
 *   buy (player pays CBN) > sell (player receives from CBN)
 *
 * This spread is the static baseline. The dynamic pricing worker applies
 * additional SPREAD_BUY_FACTOR / SPREAD_SELL_FACTOR on top of the mid-price
 * each tick, so the gap widens further at runtime.
 *
 * Formula used for each item:
 *   sell = crop_value (what the item is worth as output)
 *   buy  = ceil(sell * 1.4) minimum, typically 1.4x–1.8x of sell
 */

export type RefPrice = { buy: number; sell: number };

function p(buy: number, sell: number): RefPrice {
  const b = Math.max(1, Math.floor(buy));
  const s = Math.max(1, Math.floor(sell));
  // Hard guarantee: buy must always exceed sell
  return { buy: Math.max(b, s + 1), sell: s };
}

export const REFERENCE_GOLD: Record<string, RefPrice> = {
  // ── Seeds (player buys from CBN; seeds have no sell-back to CBN) ───────────
  // buy = seed cost from data.json; sell = ~60% of buy (seeds can be sold back at a loss)
  "seed:wheat":      p(2,  1),
  "seed:corn":       p(3,  2),
  "seed:rice":       p(3,  2),
  "seed:vanilla":    p(7,  5),
  "seed:tomato":     p(3,  2),
  "seed:tea":        p(4,  3),
  "seed:sunflower":  p(4,  3),
  "seed:sugarcane":  p(3,  2),
  "seed:strawberry": p(5,  3),
  "seed:soybean":    p(4,  3),
  "seed:sapling":    p(6,  4),
  "seed:potato":     p(3,  2),
  "seed:pepper":     p(3,  2),
  "seed:onion":      p(3,  2),
  "seed:oat":        p(3,  2),
  "seed:saffron":    p(10, 7),
  "seed:mud_pit":    p(2,  1),
  "seed:lavender":   p(4,  3),
  "seed:grapes":     p(4,  3),
  "seed:cotton":     p(4,  3),
  "seed:coffee":     p(7,  5),
  "seed:chili":      p(4,  3),
  "seed:carrot":     p(3,  2),
  "seed:cacao":      p(7,  5),

  // ── Produce (player sells to CBN; buy = CBN resells to player for crafting) ─
  // sell = produce value from data.json; buy ≈ sell × 1.5
  wheat:          p(3,  2),
  corn:           p(5,  3),
  rice:           p(6,  4),
  vanilla_pods:   p(19, 13),
  tomato:         p(6,  4),
  tea_leaves:     p(13,  9),
  sunflower_seeds:p(10,  7),
  sugarcane:      p(9,   6),
  strawberry:     p(9,   6),
  soybean:        p(9,   6),
  sapling:        p(16, 11),
  potato:         p(6,   4),
  pepper:         p(6,   4),
  onion:          p(6,   4),
  oat:            p(7,   5),
  saffron:        p(27, 18),
  mud:            p(4,   3),
  lavender:       p(10,  7),
  grape:          p(12,  8),
  cotton:         p(12,  8),
  coffee_beans:   p(18, 12),
  chili:          p(7,   5),
  carrot:         p(6,   4),
  cocoa_pods:     p(18, 12),
  sugar:          p(6,   4),

  // ── Animals (buy from CBN to own; sell = resale/slaughter value) ───────────
  "animal:chicken":  p(12,  8),
  "animal:sheep":    p(20, 15),
  "animal:cow":      p(25, 18),
  "animal:goat":     p(22, 16),
  "animal:pig":      p(24, 17),
  "animal:silkworm": p(30, 22),
  "animal:bee":      p(18, 13),

  // ── Animal produce (player sells to CBN) ───────────────────────────────────
  egg:          p(9,  6),
  wool:         p(21, 14),
  milk:         p(15, 10),
  pork:         p(18, 12),
  silk:         p(30, 20),
  honey:        p(15, 10),
  beef:         p(18, 12),
  goat_meat:    p(16, 11),
  chicken_meat: p(9,   6),

  // ── Crafted goods (player sells to CBN) ───────────────────────────────────
  "craft:flour":       p(7,   5),
  "craft:cake":        p(30, 20),
  "craft:chocolate":   p(37, 25),
  "craft:coffee":      p(22, 15),
  "craft:cheese":      p(30, 20),
  "craft:butter":      p(27, 18),
  "craft:jam":         p(27, 18),
  "craft:oil":         p(22, 15),
  "craft:cloth":       p(30, 20),
  "craft:wine":        p(37, 25),

  // ── Tools (player buys from CBN only; no sell-back) ───────────────────────
  "tool:bakery":               p(105, 70),
  "tool:mill":                 p(60,  40),
  "tool:slaughter_house":      p(150, 100),
  "tool:cheese_factory":       p(120, 80),
  "tool:butter_churn":         p(90,  60),
  "tool:winery":               p(180, 120),
  "tool:oil_press":            p(75,  50),
  "tool:chocolate_processor":  p(150, 100),
  "tool:jam_station":          p(90,  60),
};

const refKeys = new Set(Object.keys(REFERENCE_GOLD));

export function hasReferencePrice(itemId: string): boolean {
  return refKeys.has(itemId);
}

export function unitCollateralGold(itemId: string): number {
  const r = REFERENCE_GOLD[itemId];
  if (!r) return 0;
  // Use sell price as collateral basis (conservative)
  return r.sell > 0 ? r.sell : r.buy;
}

export function allPricedItemIds(): string[] {
  return Object.keys(REFERENCE_GOLD);
}

/** Treasury buys these (players can sell). All items with a sell price > 0. */
export function isTreasurySellable(itemId: string): boolean {
  const r = REFERENCE_GOLD[itemId];
  return !!(r && r.sell > 0);
}
