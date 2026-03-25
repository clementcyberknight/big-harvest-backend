-- Attack another syndicate (atomic transfer + shield deduction + cooldown)
-- KEYS:
-- 1 attackerUserSyndicateKey
-- 2 attackerBankGoldKey
-- 3 attackerBankItemsKey
-- 4 targetMetaKey
-- 5 targetBankGoldKey
-- 6 targetBankItemsKey
-- 7 targetShieldKey
-- 8 attackerCooldownKey
-- 9 idempKey
--
-- ARGV:
-- 1 userId
-- 2 attackerSyndicateId
-- 3 targetSyndicateId
-- 4 attackPower (milliseconds to deduct from shield)
-- 5 lootGoldMax
-- 6 lootItemId ("" none)
-- 7 lootItemMax
-- 8 nowMs
-- 9 cooldownMs
-- 10 idempTtlSec

local existing = redis.call('GET', KEYS[9])
if existing then
  return existing
end

local attackerSid = redis.call('GET', KEYS[1])
if not attackerSid or attackerSid == '' or attackerSid ~= ARGV[2] then
  return redis.error_reply('ERR_NOT_MEMBER')
end
if attackerSid == ARGV[3] then
  return redis.error_reply('ERR_BAD_ARGS')
end

local targetId = redis.call('HGET', KEYS[4], 'id')
if not targetId or targetId == '' then
  return redis.error_reply('ERR_NO_SUCH_SYNDICATE')
end

local nowMs = tonumber(ARGV[8]) or 0
local cdUntil = tonumber(redis.call('GET', KEYS[8]) or '0') or 0
if cdUntil > nowMs then
  return redis.error_reply('ERR_ATTACK_COOLDOWN')
end

local shieldExp = tonumber(redis.call('GET', KEYS[7]) or '0') or 0
local power = tonumber(ARGV[4]) or 0
if power <= 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end

-- Deduct shield time if active
if shieldExp > nowMs then
  local nextExp = shieldExp - power
  if nextExp < 0 then nextExp = 0 end
  redis.call('SET', KEYS[7], tostring(nextExp))
  shieldExp = nextExp
end

local lootGold = 0
local lootItemId = ''
local lootItemQty = 0

-- If shield is still active, no loot
if shieldExp > nowMs then
  redis.call('SET', KEYS[8], tostring(nowMs + (tonumber(ARGV[9]) or 0)))
  local reply = 'OK|0||0|' .. tostring(shieldExp)
  redis.call('SET', KEYS[9], reply, 'EX', tonumber(ARGV[10]) or 60)
  return reply
end

local goldMax = tonumber(ARGV[5]) or 0
if goldMax > 0 then
  local tg = tonumber(redis.call('GET', KEYS[5]) or '0') or 0
  lootGold = tg
  if lootGold > goldMax then lootGold = goldMax end
  if lootGold > 0 then
    redis.call('DECRBY', KEYS[5], lootGold)
    redis.call('INCRBY', KEYS[2], lootGold)
  end
end

local item = tostring(ARGV[6] or '')
local itemMax = tonumber(ARGV[7]) or 0
if item ~= '' and itemMax > 0 then
  local cur = tonumber(redis.call('HGET', KEYS[6], item) or '0') or 0
  lootItemQty = cur
  if lootItemQty > itemMax then lootItemQty = itemMax end
  if lootItemQty > 0 then
    redis.call('HINCRBY', KEYS[6], item, -lootItemQty)
    redis.call('HINCRBY', KEYS[3], item, lootItemQty)
    lootItemId = item
  end
end

redis.call('SET', KEYS[8], tostring(nowMs + (tonumber(ARGV[9]) or 0)))

local reply = 'OK|' .. tostring(lootGold) .. '|' .. lootItemId .. '|' .. tostring(lootItemQty) .. '|' .. tostring(shieldExp)
redis.call('SET', KEYS[9], reply, 'EX', tonumber(ARGV[10]) or 60)
return reply

