-- Deposit to syndicate bank (atomic)
-- KEYS:
-- 1 userSyndicateKey
-- 2 userWalletKey (HASH gold)
-- 3 userInvKey (HASH items)
-- 4 bankGoldKey (STRING int)
-- 5 bankItemsKey (HASH item -> qty)
-- 6 contribGoldKey (HASH userId -> qty)
-- 7 contribItemsKey (HASH "userId|itemId" -> qty)
-- 8 idempKey
--
-- ARGV:
-- 1 userId
-- 2 syndicateId
-- 3 kind ("gold"|"item")
-- 4 itemId ("" when gold)
-- 5 amount
-- 6 nowMs
-- 7 idempTtlSec

local existing = redis.call('GET', KEYS[8])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[1])
if not sid or sid == '' or sid ~= ARGV[2] then
  return redis.error_reply('ERR_NOT_MEMBER')
end

local amt = tonumber(ARGV[5])
if not amt or amt <= 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end

if ARGV[3] == 'gold' then
  local g = tonumber(redis.call('HGET', KEYS[2], 'gold') or '0') or 0
  if g < amt then
    return redis.error_reply('ERR_INSUFFICIENT_GOLD')
  end
  redis.call('HINCRBY', KEYS[2], 'gold', -amt)
  redis.call('INCRBY', KEYS[4], amt)
  redis.call('HINCRBY', KEYS[6], ARGV[1], amt)
else
  local item = tostring(ARGV[4] or '')
  if item == '' then
    return redis.error_reply('ERR_BAD_ARGS')
  end
  local cur = tonumber(redis.call('HGET', KEYS[3], item) or '0') or 0
  if cur < amt then
    return redis.error_reply('ERR_INSUFFICIENT_INV')
  end
  redis.call('HINCRBY', KEYS[3], item, -amt)
  redis.call('HINCRBY', KEYS[5], item, amt)
  redis.call('HINCRBY', KEYS[7], ARGV[1] .. '|' .. item, amt)
end

local reply = 'OK'
redis.call('SET', KEYS[8], reply, 'EX', tonumber(ARGV[7]) or 60)
return reply

