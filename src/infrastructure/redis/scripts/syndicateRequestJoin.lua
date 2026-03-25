-- Request join (or auto-join for public) (atomic)
-- KEYS:
-- 1 userSyndicateKey
-- 2 metaKey
-- 3 membersKey
-- 4 rolesKey
-- 5 joinReqKey
-- 6 idempKey
-- 7 userLevelKey (HASH field "level")
-- 8 userWalletKey (HASH field "gold")
--
-- ARGV:
-- 1 userId
-- 2 nowMs
-- 3 idempTtlSec
-- 4 maxMembers

local existing = redis.call('GET', KEYS[6])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[1])
if sid and sid ~= '' then
  return redis.error_reply('ERR_ALREADY_IN_SYNDICATE')
end

local id = redis.call('HGET', KEYS[2], 'id')
if not id or id == '' then
  return redis.error_reply('ERR_NO_SUCH_SYNDICATE')
end

-- Enforce level preference
local levelPref = tonumber(redis.call('HGET', KEYS[2], 'levelPreferenceMin') or '1') or 1
local userLevel = tonumber(redis.call('HGET', KEYS[7], 'level') or '1') or 1
if userLevel < levelPref then
  return redis.error_reply('ERR_LEVEL_TOO_LOW')
end

-- Enforce gold preference
local goldPref = tonumber(redis.call('HGET', KEYS[2], 'goldPreferenceMin') or '0') or 0
if goldPref > 0 then
  local userGold = tonumber(redis.call('HGET', KEYS[8], 'gold') or '0') or 0
  if userGold < goldPref then
    return redis.error_reply('ERR_INSUFFICIENT_GOLD')
  end
end

local vis = redis.call('HGET', KEYS[2], 'visibility') or 'public'
if vis == 'public' then
  -- Check member cap before auto-join
  local maxMembers = tonumber(ARGV[4]) or 50
  local count = tonumber(redis.call('SCARD', KEYS[3])) or 0
  if count >= maxMembers then
    return redis.error_reply('ERR_SYNDICATE_FULL')
  end
  redis.call('SADD', KEYS[3], ARGV[1])
  redis.call('HSET', KEYS[4], ARGV[1], 'member')
  redis.call('SET', KEYS[1], id)
  local reply = 'OK|JOINED'
  redis.call('SET', KEYS[6], reply, 'EX', tonumber(ARGV[3]) or 60)
  return reply
end

redis.call('SADD', KEYS[5], ARGV[1])
local reply = 'OK|REQUESTED'
redis.call('SET', KEYS[6], reply, 'EX', tonumber(ARGV[3]) or 60)
return reply
