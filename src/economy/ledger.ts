import { redis } from './redis.js';
import { supabase } from '../db/supabase.js';
import { Treasury } from './treasury.js';

export type EntityType = 'treasury' | 'player';

export interface TransferRequest {
  fromType: EntityType;
  fromId: string;
  toType: EntityType;
  toId: string;
  amount: number;
  reason: string;
  metadata?: Record<string, any>;
}

/** Redis key for treasury (internal use). Ledger uses Treasury.getId() for DB UUID. */
export const TREASURY_ID = 'treasury-singleton';

const BALANCE_FIELD = 'balance';

/**
 * Executes a double-entry token transfer entirely in Redis (fast path),
 * and asynchronously logs the transaction to Supabase (persistence).
 * Redis layout per architecture: String treasury:balance, Hash player:{id} with field 'balance'.
 */
export async function executeTransfer(req: TransferRequest): Promise<boolean> {
  if (req.amount <= 0 || !Number.isInteger(req.amount)) {
    throw new Error('Transfer amount must be a positive integer');
  }

  const fromKey = req.fromType === 'treasury' ? 'treasury:balance' : `player:${req.fromId}`;
  const toKey = req.toType === 'treasury' ? 'treasury:balance' : `player:${req.toId}`;

  const luaScript = `
    local fromKey, toKey = KEYS[1], KEYS[2]
    local fromIsStr, toIsStr = ARGV[1] == '1', ARGV[2] == '1'
    local amount = tonumber(ARGV[3])
    
    local fromBal
    if fromIsStr then
      fromBal = tonumber(redis.call('GET', fromKey) or "0")
    else
      fromBal = tonumber(redis.call('HGET', fromKey, 'balance') or "0")
    end
    if fromBal < amount then return 0 end
    
    if fromIsStr then
      redis.call('DECRBY', fromKey, amount)
    else
      redis.call('HINCRBY', fromKey, 'balance', -amount)
    end
    
    if toIsStr then
      redis.call('INCRBY', toKey, amount)
    else
      redis.call('HINCRBY', toKey, 'balance', amount)
    end
    return 1
  `;

  const result = await redis.eval(luaScript, {
    keys: [fromKey, toKey],
    arguments: [
      req.fromType === 'treasury' ? '1' : '0',
      req.toType === 'treasury' ? '1' : '0',
      req.amount.toString(),
    ],
  });

  if (result === 0) {
    return false;
  }

  // Increment velocity counters (read by pricing.ts and policy.ts from 'economy:tx_volume')
  redis.incrBy('economy:tx_volume', req.amount).catch(console.error);
  redis.incrBy('economy:tx_count', 1).catch(console.error);

  const treasuryId = await Treasury.getId();
  const fromId = req.fromType === 'treasury' ? treasuryId : req.fromId;
  const toId = req.toType === 'treasury' ? treasuryId : req.toId;

  supabase.from('ledger').insert({
    from_type: req.fromType,
    from_id: fromId,
    to_type: req.toType,
    to_id: toId,
    amount: req.amount,
    reason: req.reason,
    metadata: req.metadata || {},
  }).then(({ error }) => {
    if (error) console.error('Ledger insert failed:', error);
  });

  return true;
}

/**
 * Force-mints tokens to a player, used ONLY when migrating balances or fixing states,
 * bypassing the treasury check. Avoid using this in gameplay.
 */
export async function setPlayerBalance(playerId: string, balance: number) {
  await redis.hSet(`player:${playerId}`, { [BALANCE_FIELD]: balance.toString() });
}

/**
 * Gets a player's current balance from Redis.
 */
export async function getPlayerBalance(playerId: string): Promise<number> {
  const val = await redis.hGet(`player:${playerId}`, BALANCE_FIELD);
  return val ? parseInt(val, 10) : 0;
}
