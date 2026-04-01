-- First-time account (atomic claim via SET NX). Treasury debits starter gold.
-- KEYS[1] accountInitKey
-- KEYS[2] walletKey (HASH gold)
-- KEYS[3] invKey
-- KEYS[4] plotsKey (SET)
-- KEYS[5] treasuryReserveKey (STRING integer)
-- KEYS[6] plotSeqKey (STRING integer next plot id)
-- ARGV[1] starterGold
-- ARGV[2] seedField
-- ARGV[3] seedCount
-- ARGV[4] plotIds comma-separated

local claimed = redis.call('SET', KEYS[1], '1', 'NX')
if not claimed then
  return 'SKIP'
end

local g = tonumber(ARGV[1])
if not g or g < 0 then
  redis.call('DEL', KEYS[1])
  return redis.error_reply('ERR_BAD_ARGS')
end

local reserve = tonumber(redis.call('GET', KEYS[5]) or '0') or 0
if reserve < g then
  redis.call('DEL', KEYS[1])
  return redis.error_reply('ERR_TREASURY_DEPLETED')
end

redis.call('DECRBY', KEYS[5], g)
redis.call('HSET', KEYS[2], 'gold', g)
redis.call('SET', KEYS[6], '0')

local sc = tonumber(ARGV[3])
if sc and sc > 0 and ARGV[2] ~= '' then
  redis.call('HINCRBY', KEYS[3], ARGV[2], sc)
end

for id in string.gmatch(ARGV[4], '([^,]+)') do
  redis.call('SADD', KEYS[4], id)
  local n = tonumber(id)
  if n then
    local nextId = n + 1
    local currentSeq = tonumber(redis.call('GET', KEYS[6]) or '0') or 0
    if nextId > currentSeq then
      redis.call('SET', KEYS[6], tostring(nextId))
    end
  end
end

return 'OK'
