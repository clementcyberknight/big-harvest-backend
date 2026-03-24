-- Atomic plant: idempotency, seed check/decrement, plot write (server timestamps + output qty from server).
-- KEYS[1] plotKey
-- KEYS[2] invKey
-- KEYS[3] idempKey
-- ARGV[1] cropId
-- ARGV[2] plantedAtMs
-- ARGV[3] readyAtMs
-- ARGV[4] outputQty
-- ARGV[5] seedField
-- ARGV[6] seedCost
-- ARGV[7] idempTtlSec
-- ARGV[8] harvestItem (inventory field credited on harvest)

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local existing = redis.call('HGET', KEYS[1], 'cropId')
if type(existing) == 'string' and existing ~= '' then
  return redis.error_reply('ERR_PLOT_OCCUPIED')
end

local cost = tonumber(ARGV[6])
if not cost or cost < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local seeds = redis.call('HGET', KEYS[2], ARGV[5])
local n = tonumber(seeds)
if not n then n = 0 end
if n < cost then
  return redis.error_reply('ERR_INSUFFICIENT_SEEDS')
end

redis.call('HINCRBY', KEYS[2], ARGV[5], -cost)

redis.call('HSET', KEYS[1],
  'cropId', ARGV[1],
  'plantedAt', ARGV[2],
  'readyAt', ARGV[3],
  'outputQty', ARGV[4],
  'harvestItem', ARGV[8]
)

local payload = table.concat({
  'OK', ARGV[1], ARGV[2], ARGV[3], ARGV[4]
}, '|')

redis.call('SET', KEYS[3], payload, 'EX', ARGV[7])
return payload
