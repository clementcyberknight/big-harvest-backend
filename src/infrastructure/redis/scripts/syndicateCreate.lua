-- Create syndicate (atomic)
-- KEYS:
-- 1 seqKey
-- 2 userSyndicateKey
-- 3 userLevelKey (HASH field "level")
-- 4 nameIndexKey (HASH lower(name) -> syndicateId)
-- 5 indexAllKey
-- 6 indexPublicKey
-- 7 idempKey
--
-- ARGV:
-- 1 userId
-- 2 minLevel
-- 3 name
-- 4 description
-- 5 visibility ("public"|"private")
-- 6 levelPrefMin
-- 7 goldPrefMin
-- 8 nowMs
-- 9 idempTtlSec
-- 10 syndicateKeyPrefix (e.g. "ravolo:syndicate:")

local existing = redis.call('GET', KEYS[7])
if existing then
  return existing
end

local sid = redis.call('GET', KEYS[2])
if sid and sid ~= '' then
  return redis.error_reply('ERR_ALREADY_IN_SYNDICATE')
end

local lvl = tonumber(redis.call('HGET', KEYS[3], 'level') or '1') or 1
local minLevel = tonumber(ARGV[2]) or 13
if lvl < minLevel then
  return redis.error_reply('ERR_LEVEL_TOO_LOW')
end

local name = tostring(ARGV[3] or '')
if #name < 3 or #name > 28 then
  return redis.error_reply('ERR_BAD_NAME')
end
local nameLower = string.lower(name)
local exists = redis.call('HGET', KEYS[4], nameLower)
if exists and exists ~= '' then
  return redis.error_reply('ERR_NAME_TAKEN')
end

local nextId = tostring(redis.call('INCR', KEYS[1]))

redis.call('HSET', KEYS[4], nameLower, nextId)

local prefix = tostring(ARGV[10] or 'ravolo:syndicate:')
local metaKey = prefix .. nextId .. ':meta'
local membersKey = prefix .. nextId .. ':members'
local rolesKey = prefix .. nextId .. ':member_roles'
local joinReqKey = prefix .. nextId .. ':join_requests'
local bankGoldKey = prefix .. nextId .. ':bank_gold'
local bankItemsKey = prefix .. nextId .. ':bank_items'
local shieldKey = prefix .. nextId .. ':shield_expires_at'
local idolKey = prefix .. nextId .. ':idol'

local vis = tostring(ARGV[5] or 'public')
local nowMs = tostring(ARGV[8] or '0')
redis.call('HSET', metaKey,
  'id', nextId,
  'name', name,
  'description', tostring(ARGV[4] or ''),
  'visibility', vis,
  'levelPreferenceMin', tostring(ARGV[6] or '1'),
  'goldPreferenceMin', tostring(ARGV[7] or '0'),
  'emblemId', tostring(ARGV[11] or 'emblem:default'),
  'ownerId', tostring(ARGV[1] or ''),
  'createdAtMs', nowMs,
  'disbanded', '0'
)

redis.call('SADD', membersKey, tostring(ARGV[1] or ''))
redis.call('HSET', rolesKey, tostring(ARGV[1] or ''), 'owner')
redis.call('DEL', joinReqKey)
redis.call('SET', bankGoldKey, '0', 'NX')
redis.call('DEL', bankItemsKey)
redis.call('SET', shieldKey, '0')
redis.call('HSET', idolKey, 'level', '0', 'status', 'none')

redis.call('SADD', KEYS[5], nextId)
if vis == 'public' then
  redis.call('SADD', KEYS[6], nextId)
end

redis.call('SET', KEYS[2], nextId)

local reply = 'OK|' .. nextId
redis.call('SET', KEYS[7], reply, 'EX', tonumber(ARGV[9]) or 60)
return reply

