-- Sell produce to treasury: inventory down, wallet up, reserve down, metrics up.
-- Price is precomputed in Node (ARGV[3]); Lua never derives price.
-- KEYS[1] invKey
-- KEYS[2] walletKey
-- KEYS[3] idempKey
-- KEYS[4] treasuryReserveKey
-- KEYS[5] sellFlowKey (HASH)
-- KEYS[6] tradesStreamKey
-- ARGV[1] item
-- ARGV[2] quantity
-- ARGV[3] goldPayout (integer micro settlement in whole gold units here — server passes GOLD not micro)
-- Actually user spec: total gold — use whole gold integers for wallet and reserve.
-- ARGV[3] goldPayout whole gold
-- ARGV[4] idempTtlSec
-- ARGV[5] streamEnable 0|1
-- ARGV[6] userId
-- ARGV[7] tsMs

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local q = tonumber(ARGV[2])
if not q or q < 1 then
  return redis.error_reply('ERR_BAD_QTY')
end

local have = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0') or 0
if have < q then
  return redis.error_reply('ERR_INSUFFICIENT_INV')
end

local pay = tonumber(ARGV[3])
if not pay or pay < 0 then
  return redis.error_reply('ERR_BAD_GOLD')
end

local reserve = tonumber(redis.call('GET', KEYS[4]) or '0') or 0
if reserve < pay then
  return redis.error_reply('ERR_TREASURY_DEPLETED')
end

redis.call('HINCRBY', KEYS[1], ARGV[1], -q)
redis.call('HINCRBY', KEYS[2], 'gold', pay)
redis.call('DECRBY', KEYS[4], pay)
redis.call('HINCRBY', KEYS[5], ARGV[1], q)

local payload = table.concat({'OK', ARGV[1], ARGV[2], ARGV[3]}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[4])

if ARGV[5] == '1' then
  redis.call('XADD', KEYS[6], '*',
    'side', 'sell',
    'userId', ARGV[6],
    'item', ARGV[1],
    'qty', ARGV[2],
    'gold', ARGV[3],
    'ts', ARGV[7]
  )
end

return payload
