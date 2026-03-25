-- Accept join request (atomic)
-- KEYS:
-- 1 actorUserSyndicateKey
-- 2 metaKey
-- 3 joinReqKey
-- 4 membersKey
-- 5 rolesKey
-- 6 targetUserSyndicateKey
-- 7 idempKey
--
-- ARGV:
-- 1 actorUserId
-- 2 targetUserId
-- 3 nowMs
-- 4 idempTtlSec
-- 5 maxMembers

local existing = redis.call('GET', KEYS[7])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[1])
local metaId = redis.call('HGET', KEYS[2], 'id')
if not metaId or metaId == '' then
  return redis.error_reply('ERR_NO_SUCH_SYNDICATE')
end
if not sid or sid == '' or sid ~= metaId then
  return redis.error_reply('ERR_NOT_MEMBER')
end

local role = redis.call('HGET', KEYS[5], ARGV[1]) or 'member'
if role ~= 'owner' and role ~= 'officer' then
  return redis.error_reply('ERR_NOT_AUTHORIZED')
end

local req = redis.call('SISMEMBER', KEYS[3], ARGV[2])
if req ~= 1 then
  return redis.error_reply('ERR_JOIN_REQUEST_MISSING')
end

local targetSid = redis.call('GET', KEYS[6])
if targetSid and targetSid ~= '' then
  return redis.error_reply('ERR_TARGET_ALREADY_IN_SYNDICATE')
end

-- Check member cap before accepting
local maxMembers = tonumber(ARGV[5]) or 50
local count = tonumber(redis.call('SCARD', KEYS[4])) or 0
if count >= maxMembers then
  return redis.error_reply('ERR_SYNDICATE_FULL')
end

redis.call('SREM', KEYS[3], ARGV[2])
redis.call('SADD', KEYS[4], ARGV[2])
redis.call('HSET', KEYS[5], ARGV[2], 'member')
redis.call('SET', KEYS[6], metaId)

local reply = 'OK'
redis.call('SET', KEYS[7], reply, 'EX', tonumber(ARGV[4]) or 60)
return reply
