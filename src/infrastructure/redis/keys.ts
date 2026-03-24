/** Hash tag `{userId}` keeps user-scoped keys on the same Redis Cluster slot. */

export const TREASURY_HASH_TAG = "{treasury}";

export function userTag(userId: string): string {
  return `{${userId}}`;
}

export function plotKey(userId: string, plotId: number): string {
  return `ravolo:${userTag(userId)}:plot:${plotId}`;
}

export function inventoryKey(userId: string): string {
  return `ravolo:${userTag(userId)}:inv`;
}

export function inventoryLockedKey(userId: string): string {
  return `ravolo:${userTag(userId)}:inv_locked`;
}

export function ownedPlotsKey(userId: string): string {
  return `ravolo:${userTag(userId)}:plots`;
}

export function plotsLockedKey(userId: string): string {
  return `ravolo:${userTag(userId)}:plots_locked`;
}

export function walletKey(userId: string): string {
  return `ravolo:${userTag(userId)}:wallet`;
}

export function accountInitKey(userId: string): string {
  return `ravolo:${userTag(userId)}:account_init`;
}

export function userLevelKey(userId: string): string {
  return `ravolo:${userTag(userId)}:lvl`;
}

export function plantIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:plant:${requestId}`;
}

export function harvestIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:harvest:${requestId}`;
}

export function sellIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:sell:${requestId}`;
}

export function buyIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:buy:${requestId}`;
}

export function loanActiveKey(userId: string): string {
  return `ravolo:${userTag(userId)}:loan_active`;
}

export function loanRecordKey(userId: string, loanId: string): string {
  return `ravolo:${userTag(userId)}:loan:${loanId}`;
}

export function loanOpenIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:loan_open:${requestId}`;
}

export function loanRepayIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:loan_repay:${requestId}`;
}

export function animalStateKey(userId: string): string {
  return `ravolo:${userTag(userId)}:animal_state`;
}

export function animalFeedIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:animal_feed:${requestId}`;
}

export function animalHarvestIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:animal_harvest:${requestId}`;
}

export function craftPendingKey(userId: string): string {
  return `ravolo:${userTag(userId)}:craft_pending`;
}

export function craftStartIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:craft_start:${requestId}`;
}

export function craftClaimIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:craft_claim:${requestId}`;
}

export function seedInventoryField(cropId: string): string {
  return `seed:${cropId}`;
}

/** Global treasury gold pool (string integer). */
export function treasuryReserveKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:reserve`;
}

/** HASH field=item → micro price per unit. */
export function treasuryPricesKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:prices`;
}

/** HASH cumulative buy volumes (per tick window; worker may decay). */
export function treasuryBuyFlowKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:flow_buy`;
}

/** HASH cumulative sell volumes. */
export function treasurySellFlowKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:flow_sell`;
}

export function treasuryTradesStreamKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:trades`;
}

export function treasuryPriceHistoryKey(itemId: string): string {
  return `ravolo:${TREASURY_HASH_TAG}:ph:${itemId}`;
}
