-- Request join (or auto-join for public) (atomic)
-- KEYS:
-- 1 userSyndicateKey
-- 2 metaKey
-- 3 membersKey
-- 4 rolesKey
-- 5 joinReqKey
-- 6 idempKey
--
-- ARGV:
-- 1 userId
-- 2 nowMs
-- 3 idempTtlSec

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

local vis = redis.call('HGET', KEYS[2], 'visibility') or 'public'
if vis == 'public' then
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

