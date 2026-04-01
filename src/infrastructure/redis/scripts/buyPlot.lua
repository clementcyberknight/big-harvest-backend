-- Buy the next sequential plot: wallet down, treasury reserve up, plot ownership up.
-- KEYS[1] walletKey
-- KEYS[2] plotsKey
-- KEYS[3] plotsLockedKey
-- KEYS[4] plotSeqKey
-- KEYS[5] idempKey
-- KEYS[6] reserveKey
-- ARGV[1] starterPlotCount
-- ARGV[2] maxPlots
-- ARGV[3] baseGold
-- ARGV[4] stepGold
-- ARGV[5] idempTtlSec
-- ARGV[6] plotKeyPrefix

local cached = redis.call('GET', KEYS[5])
if cached then
  return cached
end

local starterCount = tonumber(ARGV[1])
local maxPlots = tonumber(ARGV[2])
local baseGold = tonumber(ARGV[3])
local stepGold = tonumber(ARGV[4])

if not starterCount or starterCount < 0 or not maxPlots or maxPlots < 1 or not baseGold or baseGold < 0 or not stepGold or stepGold < 0 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local nextPlotId = tonumber(redis.call('GET', KEYS[4]) or '-1')
if not nextPlotId or nextPlotId < 0 then
  nextPlotId = (tonumber(redis.call('SCARD', KEYS[2]) or '0') or 0) + (tonumber(redis.call('SCARD', KEYS[3]) or '0') or 0)
  if nextPlotId < starterCount then
    nextPlotId = starterCount
  end
end

if nextPlotId >= maxPlots then
  return redis.error_reply('ERR_MAX_PLOTS')
end

local extraIndex = nextPlotId - starterCount
if extraIndex < 0 then
  extraIndex = 0
end

local cost = baseGold + (extraIndex * stepGold)
local balance = tonumber(redis.call('HGET', KEYS[1], 'gold') or '0') or 0
if balance < cost then
  return redis.error_reply('ERR_INSUFFICIENT_GOLD')
end

redis.call('HINCRBY', KEYS[1], 'gold', -cost)
redis.call('INCRBY', KEYS[6], cost)
redis.call('SADD', KEYS[2], tostring(nextPlotId))
redis.call('SET', KEYS[4], tostring(nextPlotId + 1))
redis.call('DEL', ARGV[6] .. tostring(nextPlotId))

local payload = table.concat({'OK', tostring(nextPlotId), tostring(cost)}, '|')
redis.call('SET', KEYS[5], payload, 'EX', ARGV[5])

return payload
