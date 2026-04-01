-- Atomically purchase a new plot slot for the player.
-- Deducts goldCost from wallet, assigns the next sequential plotId into the
-- player's owned-plots SET, and records an idempotency key.
--
-- KEYS[1]  walletKey          HASH  gold field
-- KEYS[2]  plotsKey           SET   of owned plot id strings
-- KEYS[3]  idempKey           STRING idempotency record
-- KEYS[4]  treasuryReserveKey STRING integer gold pool
--
-- ARGV[1]  goldCost           integer gold to deduct
-- ARGV[2]  maxOwnedPlots      integer ceiling on plots the player may own
-- ARGV[3]  idempTtlSec        integer TTL for idempotency key
-- ARGV[4]  userId             string  for stream annotation (unused here, reserved)
-- ARGV[5]  tsMs               string  timestamp millis (reserved)

-- Idempotency: if this requestId was already processed, replay the result.
local existing = redis.call('GET', KEYS[3])
if existing then
  return existing
end

local goldCost     = tonumber(ARGV[1])
local maxPlots     = tonumber(ARGV[2])
local idempTtlSec  = tonumber(ARGV[3])

if not goldCost or goldCost < 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end

-- Check current wallet balance
local currentGold = tonumber(redis.call('HGET', KEYS[1], 'gold') or '0') or 0
if currentGold < goldCost then
  return redis.error_reply('ERR_INSUFFICIENT_GOLD')
end

-- Check plot cap
local currentPlotCount = tonumber(redis.call('SCARD', KEYS[2])) or 0
if currentPlotCount >= maxPlots then
  return redis.error_reply('ERR_PLOT_CAP_REACHED')
end

-- Determine the next plotId: find the max existing plotId and add 1.
-- Since plotIds are non-negative integers stored as strings in the SET,
-- we iterate to find the current maximum.
local members = redis.call('SMEMBERS', KEYS[2])
local maxId = -1
for _, v in ipairs(members) do
  local n = tonumber(v)
  if n and n > maxId then
    maxId = n
  end
end
local newPlotId = maxId + 1

-- Deduct gold and add new plot slot
redis.call('HINCRBY', KEYS[1], 'gold', -goldCost)
redis.call('SADD', KEYS[2], tostring(newPlotId))

-- Treasury receives the gold (re-credit the reserve)
redis.call('INCRBY', KEYS[4], goldCost)

-- Build result string and store for idempotency
local result = 'OK|' .. tostring(newPlotId) .. '|' .. tostring(goldCost)
redis.call('SET', KEYS[3], result, 'EX', idempTtlSec)

return result
