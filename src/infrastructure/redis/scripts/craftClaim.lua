-- Claim finished craft output (server time checked here).
-- KEYS[1] invKey
-- KEYS[2] craftPendingKey
-- KEYS[3] idempKey
-- ARGV[1] pendingId
-- ARGV[2] nowMs
-- ARGV[3] idempTtlSec

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local raw = redis.call('HGET', KEYS[2], ARGV[1])
if type(raw) ~= 'string' or raw == '' then
  return redis.error_reply('ERR_NO_CRAFT')
end

local ra, item, qtys = string.match(raw, '^(%d+)|([^|]+)|(%d+)$')
if not ra or not item or not qtys then
  return redis.error_reply('ERR_BAD_PENDING')
end

local readyAt = tonumber(ra)
local qty = tonumber(qtys)
local now = tonumber(ARGV[2])
if not readyAt or not qty or not now then
  return redis.error_reply('ERR_BAD_ARGS')
end

if now < readyAt then
  return redis.error_reply('ERR_NOT_READY')
end

redis.call('HINCRBY', KEYS[1], item, qty)
redis.call('HDEL', KEYS[2], ARGV[1])

local payload = table.concat({'OK', item, tostring(qty)}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[3])
return payload
