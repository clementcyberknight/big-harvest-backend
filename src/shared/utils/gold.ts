import { PRICE_MICRO_PER_GOLD } from "../../config/constants.js";

/**
 * Gold payout when player sells to treasury.
 * Always returns a safe integer — Lua HINCRBY/DECRBY require integer strings.
 */
export function sellPayoutGold(priceMicro: number, qty: number): number {
  return Math.floor((Math.floor(priceMicro) * Math.floor(qty)) / PRICE_MICRO_PER_GOLD);
}

/**
 * Gold cost when player buys from treasury.
 * Always returns a safe integer — Lua HINCRBY/INCRBY require integer strings.
 */
export function buyCostGold(priceMicro: number, qty: number): number {
  return Math.ceil((Math.ceil(priceMicro) * Math.floor(qty)) / PRICE_MICRO_PER_GOLD);
}

/** Clamp and round any gold value to a safe Redis integer. */
export function toSafeGold(value: number): number {
  return Math.max(0, Math.floor(value));
}
