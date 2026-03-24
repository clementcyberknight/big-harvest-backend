-- Harvest animal produce: requires fed window valid and timer elapsed.
-- KEYS[1] invKey
-- KEYS[2] animalStateKey
-- KEYS[3] idempKey
-- ARGV[1] speciesKey
-- ARGV[2] animalInvField
-- ARGV[3] produceItem
-- ARGV[4] maxProduce (cap per action)
-- ARGV[5] produceIntervalMs
-- ARGV[6] nowMs
-- ARGV[7] idempTtlSec

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local sk = ARGV[1]
local fk = sk .. ':fedUntil'
local nk = sk .. ':nextProduce'

local now = tonumber(ARGV[6])
if not now then
  return redis.error_reply('ERR_BAD_ARGS')
end

local fedUntil = tonumber(redis.call('HGET', KEYS[2], fk) or '0') or 0
if fedUntil < 1 or now > fedUntil then
  return redis.error_reply('ERR_NOT_FED')
end

local nextP = tonumber(redis.call('HGET', KEYS[2], nk) or '0') or 0
if nextP < 1 or now < nextP then
  return redis.error_reply('ERR_NOT_READY')
end

local count = tonumber(redis.call('HGET', KEYS[1], ARGV[2]) or '0') or 0
if count < 1 then
  return redis.error_reply('ERR_NO_ANIMALS')
end

local cap = tonumber(ARGV[4])
if not cap or cap < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local outQty = count
if outQty > cap then
  outQty = cap
end

local interval = tonumber(ARGV[5])
if not interval or interval < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

redis.call('HINCRBY', KEYS[1], ARGV[3], outQty)
redis.call('HSET', KEYS[2], nk, tostring(now + interval))

local payload = table.concat({'OK', ARGV[3], tostring(outQty), tostring(now + interval)}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[7])
return payload
