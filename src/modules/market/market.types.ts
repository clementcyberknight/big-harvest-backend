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
