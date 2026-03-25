-- Buy/extend shield (atomic)
-- KEYS:
-- 1 userSyndicateKey
-- 2 bankGoldKey (STRING int)
-- 3 shieldKey (STRING unix ms)
-- 4 idempKey
--
-- ARGV:
-- 1 userId
-- 2 syndicateId
-- 3 goldPaid
-- 4 nowMs
-- 5 durationMultiplierMsPerGold
-- 6 idempTtlSec

local existing = redis.call('GET', KEYS[4])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[1])
if not sid or sid == '' or sid ~= ARGV[2] then
  return redis.error_reply('ERR_NOT_MEMBER')
end

local paid = tonumber(ARGV[3])
if not paid or paid <= 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local bank = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
if bank < paid then
  return redis.error_reply('ERR_INSUFFICIENT_GOLD')
end

redis.call('DECRBY', KEYS[2], paid)

local nowMs = tonumber(ARGV[4]) or 0
local curExp = tonumber(redis.call('GET', KEYS[3]) or '0') or 0
local base = curExp
if base < nowMs then base = nowMs end

local mult = tonumber(ARGV[5]) or 0
if mult <= 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end
local dur = paid * mult
local nextExp = base + dur

redis.call('SET', KEYS[3], tostring(nextExp))

local reply = 'OK|' .. tostring(nextExp)
redis.call('SET', KEYS[4], reply, 'EX', tonumber(ARGV[6]) or 60)
return reply

