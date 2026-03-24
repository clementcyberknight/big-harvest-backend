-- Feed all animals of one species: consume feed from inventory, refresh fed window, arm next produce tick.
-- KEYS[1] invKey
-- KEYS[2] animalStateKey (HASH)
-- KEYS[3] idempKey
-- ARGV[1] speciesKey (e.g. chicken)
-- ARGV[2] animalInvField (animal:chicken)
-- ARGV[3] feedItem
-- ARGV[4] feedPerAnimal (int)
-- ARGV[5] nowMs
-- ARGV[6] produceIntervalMs
-- ARGV[7] fedWindowMs
-- ARGV[8] idempTtlSec

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local sk = ARGV[1]
local fk = sk .. ':fedUntil'
local nk = sk .. ':nextProduce'

local count = tonumber(redis.call('HGET', KEYS[1], ARGV[2]) or '0') or 0
if count < 1 then
  return redis.error_reply('ERR_NO_ANIMALS')
end

local fpa = tonumber(ARGV[4])
if not fpa or fpa < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local need = fpa * count
local have = tonumber(redis.call('HGET', KEYS[1], ARGV[3]) or '0') or 0
if have < need then
  return redis.error_reply('ERR_INSUFFICIENT_FEED')
end

redis.call('HINCRBY', KEYS[1], ARGV[3], -need)

local now = tonumber(ARGV[5])
local window = tonumber(ARGV[7])
local interval = tonumber(ARGV[6])
if not now or not window or not interval then
  return redis.error_reply('ERR_BAD_ARGS')
end

redis.call('HSET', KEYS[2], fk, tostring(now + window))
redis.call('HSET', KEYS[2], nk, tostring(now + interval))

local payload = table.concat({'OK', sk, tostring(need), tostring(now + interval)}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[8])
return payload
