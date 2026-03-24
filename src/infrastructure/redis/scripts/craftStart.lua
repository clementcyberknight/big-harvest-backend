-- Start timed craft: verify tool, deduct ingredients, store pending completion.
-- KEYS[1] invKey
-- KEYS[2] craftPendingKey (HASH field = pendingId)
-- KEYS[3] idempKey
-- ARGV[1] pendingId
-- ARGV[2] toolField
-- ARGV[3] toolMin
-- ARGV[4] ingredientSpec item:qty|item:qty
-- ARGV[5] readyAtMs
-- ARGV[6] outputItem
-- ARGV[7] outputQty
-- ARGV[8] idempTtlSec

local cached = redis.call('GET', KEYS[3])
if cached then
  return cached
end

local tmin = tonumber(ARGV[3])
if not tmin or tmin < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local owned = tonumber(redis.call('HGET', KEYS[1], ARGV[2]) or '0') or 0
if owned < tmin then
  return redis.error_reply('ERR_MISSING_TOOL')
end

local spec = ARGV[4]
if spec == '' then
  return redis.error_reply('ERR_BAD_SPEC')
end

for chunk in string.gmatch(spec, '([^|]+)') do
  local item, qtys = string.match(chunk, '^([^:]+):(%d+)$')
  if not item or not qtys then
    return redis.error_reply('ERR_BAD_SPEC')
  end
  local q = tonumber(qtys)
  if not q or q < 1 then
    return redis.error_reply('ERR_BAD_SPEC')
  end
  local have = tonumber(redis.call('HGET', KEYS[1], item) or '0') or 0
  if have < q then
    return redis.error_reply('ERR_INSUFFICIENT_INV')
  end
  redis.call('HINCRBY', KEYS[1], item, -q)
end

local val = table.concat({ARGV[5], ARGV[6], ARGV[7]}, '|')
redis.call('HSET', KEYS[2], ARGV[1], val)

local payload = table.concat({'OK', ARGV[1], ARGV[5], ARGV[6], ARGV[7]}, '|')
redis.call('SET', KEYS[3], payload, 'EX', ARGV[8])
return payload
