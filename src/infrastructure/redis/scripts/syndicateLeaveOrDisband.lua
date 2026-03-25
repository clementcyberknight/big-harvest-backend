-- Leave syndicate or disband (owner) (atomic)
-- KEYS:
-- 1 userSyndicateKey (for actor)
-- 2 nameIndexKey (HASH lower(name) -> syndicateId)
-- 3 indexAllKey (SET)
-- 4 indexPublicKey (SET)
-- 5 idempKey
--
-- ARGV:
-- 1 mode ("leave"|"disband")
-- 2 actorUserId
-- 3 syndicateId (required for disband)
-- 4 nowMs
-- 5 idempTtlSec

local existing = redis.call('GET', KEYS[5])
if existing then
  return existing
end

local mode = tostring(ARGV[1] or '')
local actor = tostring(ARGV[2] or '')

if mode == 'leave' then
  local sid = redis.call('GET', KEYS[1])
  if not sid or sid == '' then
    redis.call('SET', KEYS[5], 'OK', 'EX', tonumber(ARGV[5]) or 60)
    return 'OK'
  end
  local rolesKey = 'ravolo:syndicate:' .. sid .. ':member_roles'
  local role = redis.call('HGET', rolesKey, actor) or 'member'
  if role == 'owner' then
    return redis.error_reply('ERR_OWNER_CANNOT_LEAVE')
  end
  redis.call('SREM', 'ravolo:syndicate:' .. sid .. ':members', actor)
  redis.call('HDEL', rolesKey, actor)
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[5], 'OK', 'EX', tonumber(ARGV[5]) or 60)
  return 'OK'
end

if mode ~= 'disband' then
  return redis.error_reply('ERR_BAD_ARGS')
end

local sid = tostring(ARGV[3] or '')
if sid == '' then
  return redis.error_reply('ERR_BAD_ARGS')
end

local actorSid = redis.call('GET', KEYS[1])
if not actorSid or actorSid == '' or actorSid ~= sid then
  return redis.error_reply('ERR_NOT_MEMBER')
end

local rolesKey = 'ravolo:syndicate:' .. sid .. ':member_roles'
local role = redis.call('HGET', rolesKey, actor) or 'member'
if role ~= 'owner' then
  return redis.error_reply('ERR_NOT_AUTHORIZED')
end

local metaKey = 'ravolo:syndicate:' .. sid .. ':meta'
local name = redis.call('HGET', metaKey, 'name') or ''
local vis = redis.call('HGET', metaKey, 'visibility') or 'public'

-- Remove indexes
redis.call('SREM', KEYS[3], sid)
if vis == 'public' then
  redis.call('SREM', KEYS[4], sid)
end
if name ~= '' then
  redis.call('HDEL', KEYS[2], string.lower(name))
end

-- Clear membership pointers
local membersKey = 'ravolo:syndicate:' .. sid .. ':members'
local members = redis.call('SMEMBERS', membersKey)
if members and #members > 500 then
  return redis.error_reply('ERR_TOO_MANY_MEMBERS')
end
for _, uid in ipairs(members) do
  local userKey = 'ravolo:{' .. uid .. '}:syndicate_id'
  redis.call('DEL', userKey)
end

-- Delete syndicate keys
redis.call('DEL', metaKey)
redis.call('DEL', membersKey)
redis.call('DEL', rolesKey)
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':join_requests')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':bank_gold')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':bank_items')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':shield_expires_at')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':idol')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':chat')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':member_seen')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':contrib_gold')
redis.call('DEL', 'ravolo:syndicate:' .. sid .. ':contrib_items')

redis.call('SET', KEYS[5], 'OK', 'EX', tonumber(ARGV[5]) or 60)
return 'OK'

