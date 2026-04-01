import { PRICE_MICRO_PER_GOLD } from "../../config/constants.js";

export type SellResult = {
  item: string;
  quantity: number;
  goldPaid: number;
  priceMicro: number;
};

export type BuyResult = {
  item: string;
  quantity: number;
  goldSpent: number;
  priceMicro: number;
};

export type MarketPrice = {
  buy: number | null;
  sell: number | null;
};

export type MarketStatus = Record<string, MarketPrice>;

export type MarketPriceGold = {
  buy: number | null;
  sell: number | null;
};

export type MarketStatusGold = Record<string, MarketPriceGold>;

export function toGoldUnits(priceMicro: number | null): number | null {
  if (priceMicro === null) return null;
  return Math.round((priceMicro / PRICE_MICRO_PER_GOLD) * 100) / 100;
}

export function marketStatusToGoldUnits(status: MarketStatus): MarketStatusGold {
  const converted: MarketStatusGold = {};

  for (const [itemId, price] of Object.entries(status)) {
    converted[itemId] = {
      buy: toGoldUnits(price.buy),
      sell: toGoldUnits(price.sell),
    };
  }

  return converted;
}
