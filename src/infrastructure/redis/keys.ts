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

/** HASH field=item → mid micro price per unit (used internally by pricing worker). */
export function treasuryPricesKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:prices`;
}

/** HASH field=item → buy micro price per unit (what player pays to CBN). */
export function treasuryBuyPricesKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:prices_buy`;
}

/** HASH field=item → sell micro price per unit (what player receives from CBN). */
export function treasurySellPricesKey(): string {
  return `ravolo:${TREASURY_HASH_TAG}:prices_sell`;
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

/** One-time Solana auth challenge message (UTF-8 string), keyed by challenge id. */
export function authChallengeKey(challengeId: string): string {
  return `ravolo:auth:challenge:${challengeId}`;
}

/** SHA-256 hex of opaque refresh token (never store raw token in key logs). */
export function refreshTokenStorageKey(tokenHashHex: string): string {
  return `ravolo:auth:rt:${tokenHashHex}`;
}

/** LIST of JSON lines; worker batches to Supabase (hot path only RPUSH). */
export function userActionsQueueKey(): string {
  return "ravolo:user_actions:queue";
}

// --- Syndicates ---

export function userSyndicateIdKey(userId: string): string {
  return `ravolo:${userTag(userId)}:syndicate_id`;
}

export function userLastSeenKey(userId: string): string {
  return `ravolo:${userTag(userId)}:last_seen_ms`;
}

export function userAttackCooldownKey(userId: string): string {
  return `ravolo:${userTag(userId)}:attack_cd_until`;
}

export function syndicateSeqKey(): string {
  return "ravolo:syndicate:seq";
}

export function syndicateIndexAllKey(): string {
  return "ravolo:syndicate:index:all";
}

export function syndicateIndexPublicKey(): string {
  return "ravolo:syndicate:index:public";
}

export function syndicateNameIndexKey(): string {
  return "ravolo:syndicate:index:name";
}

export function syndicateMetaKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:meta`;
}

export function syndicateMembersKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:members`;
}

export function syndicateMemberRolesKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:member_roles`;
}

export function syndicateJoinRequestsKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:join_requests`;
}

export function syndicateBankGoldKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:bank_gold`;
}

export function syndicateBankItemsKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:bank_items`;
}

export function syndicateHoldingsKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:holdings`;
}

export function syndicateShieldExpiresAtKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:shield_expires_at`;
}

export function syndicateIdolKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:idol`;
}

export function syndicateIdolRequestKey(syndicateId: string, requestKey: string): string {
  return `ravolo:syndicate:${syndicateId}:idol:req:${requestKey}`;
}

export function syndicateChatKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:chat`;
}

export function syndicateMemberSeenKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:member_seen`;
}

export function syndicateContributionGoldKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:contrib_gold`;
}

export function syndicateContributionItemsKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:contrib_items`;
}

export function syndicateTaxPenaltyKey(syndicateId: string): string {
  return `ravolo:syndicate:${syndicateId}:tax_penalty`;
}

// --- Plot purchase ---

export function buyPlotIdempotencyKey(userId: string, requestId: string): string {
  return `ravolo:${userTag(userId)}:idemp:buy_plot:${requestId}`;
}
