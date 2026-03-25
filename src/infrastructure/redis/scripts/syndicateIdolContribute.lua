-- Contribute items from syndicate bank toward idol request (atomic)
-- KEYS:
-- 1 userSyndicateKey
-- 2 bankItemsKey
-- 3 idolReqKey (HASH: itemId, required, progress, deadlineMs, status)
-- 4 idolKey (HASH)
-- 5 idempKey
--
-- ARGV:
-- 1 userId
-- 2 syndicateId
-- 3 requestKey
-- 4 itemId
-- 5 amount
-- 6 nowMs
-- 7 idempTtlSec

local existing = redis.call('GET', KEYS[5])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[1])
if not sid or sid == '' or sid ~= ARGV[2] then
  return redis.error_reply('ERR_NOT_MEMBER')
end

local reqItem = redis.call('HGET', KEYS[3], 'itemId')
if not reqItem or reqItem == '' then
  return redis.error_reply('ERR_NO_IDOL_REQUEST')
end
if reqItem ~= ARGV[4] then
  return redis.error_reply('ERR_BAD_ARGS')
end

local required = tonumber(redis.call('HGET', KEYS[3], 'required') or '0') or 0
local progress = tonumber(redis.call('HGET', KEYS[3], 'progress') or '0') or 0
local amt = tonumber(ARGV[5]) or 0
if amt <= 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end
if progress >= required then
  local replyDone = 'OK|1'
  redis.call('SET', KEYS[5], replyDone, 'EX', tonumber(ARGV[7]) or 60)
  return replyDone
end

if progress + amt > required then
  amt = required - progress
end

local bankCur = tonumber(redis.call('HGET', KEYS[2], reqItem) or '0') or 0
if bankCur < amt then
  return redis.error_reply('ERR_INSUFFICIENT_INV')
end

redis.call('HINCRBY', KEYS[2], reqItem, -amt)
local nextProg = redis.call('HINCRBY', KEYS[3], 'progress', amt)

local fulfilled = 0
if tonumber(nextProg) >= required then
  redis.call('HSET', KEYS[3], 'status', 'fulfilled', 'fulfilledAtMs', tostring(ARGV[6] or '0'))
  fulfilled = 1
end

local reply = 'OK|' .. tostring(fulfilled)
redis.call('SET', KEYS[5], reply, 'EX', tonumber(ARGV[7]) or 60)
return reply

