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
