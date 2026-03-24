-- Atomic harvest: idempotency, readiness (server now), inventory credit, plot clear.
-- KEYS[1] plotKey
-- KEYS[2] invKey
-- KEYS[3] idempKey
-- ARGV[1] nowMs
-- ARGV[2] idempTtlSec

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local cropId = redis.call('HGET', KEYS[1], 'cropId')
if type(cropId) ~= 'string' or cropId == '' then
  return redis.error_reply('ERR_EMPTY_PLOT')
end

local harvestItem = redis.call('HGET', KEYS[1], 'harvestItem')
if type(harvestItem) ~= 'string' or harvestItem == '' then
  harvestItem = cropId
end

local readyRaw = redis.call('HGET', KEYS[1], 'readyAt')
if type(readyRaw) ~= 'string' or readyRaw == '' then
  return redis.error_reply('ERR_EMPTY_PLOT')
end

local now = tonumber(ARGV[1])
local readyAt = tonumber(readyRaw)
if not now or not readyAt then
  return redis.error_reply('ERR_BAD_CLOCK')
end
if now < readyAt then
  return redis.error_reply('ERR_NOT_READY')
end

local outRaw = redis.call('HGET', KEYS[1], 'outputQty')
local qty = tonumber(outRaw)
if not qty or qty < 1 then
  return redis.error_reply('ERR_INVALID_OUTPUT')
end

redis.call('HINCRBY', KEYS[2], harvestItem, qty)
redis.call('DEL', KEYS[1])

local payload = table.concat({ 'OK', harvestItem, tostring(qty) }, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[2])
return payload
