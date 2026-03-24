-- Buy from treasury: wallet down, inventory up, reserve up, buy-flow metrics up.
-- Total cost precomputed in Node (ARGV[3]).
-- KEYS[1] invKey
-- KEYS[2] walletKey
-- KEYS[3] idempKey
-- KEYS[4] treasuryReserveKey
-- KEYS[5] buyFlowKey (HASH)
-- KEYS[6] tradesStreamKey
-- ARGV[1] item (inventory field)
-- ARGV[2] quantity
-- ARGV[3] goldCost (whole gold)
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

local cost = tonumber(ARGV[3])
if not cost or cost < 0 then
  return redis.error_reply('ERR_BAD_GOLD')
end

local bal = tonumber(redis.call('HGET', KEYS[2], 'gold') or '0') or 0
if bal < cost then
  return redis.error_reply('ERR_INSUFFICIENT_GOLD')
end

redis.call('HINCRBY', KEYS[2], 'gold', -cost)
redis.call('HINCRBY', KEYS[1], ARGV[1], q)
redis.call('INCRBY', KEYS[4], cost)
redis.call('HINCRBY', KEYS[5], ARGV[1], q)

local payload = table.concat({'OK', ARGV[1], ARGV[2], ARGV[3]}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[4])

if ARGV[5] == '1' then
  redis.call('XADD', KEYS[6], '*',
    'side', 'buy',
    'userId', ARGV[6],
    'item', ARGV[1],
    'qty', ARGV[2],
    'gold', ARGV[3],
    'ts', ARGV[7]
  )
end

return payload
