import { PRICE_MICRO_PER_GOLD } from "../../config/constants.js";

export function sellPayoutGold(priceMicro: number, qty: number): number {
  return Math.floor((priceMicro * qty) / PRICE_MICRO_PER_GOLD);
}

export function buyCostGold(priceMicro: number, qty: number): number {
  return Math.ceil((priceMicro * qty) / PRICE_MICRO_PER_GOLD);
}
