-- Atomic decay: deletes plot if current time > readyAt + max_decay_ms
-- KEYS[1] plotKey
-- ARGV[1] currentTimeMs
-- ARGV[2] maxDecayMs

local cropId = redis.call('HGET', KEYS[1], 'cropId')
if type(cropId) ~= 'string' or cropId == '' then
  return 'NO_CROP'
end

local readyAt = redis.call('HGET', KEYS[1], 'readyAt')
local r = tonumber(readyAt)
if not r then
  return 'NOT_READY'
end

local now = tonumber(ARGV[1])
local maxDecay = tonumber(ARGV[2])

if now > (r + maxDecay) then
  redis.call('DEL', KEYS[1])
  return 'DECAYED'
end

return 'SAFE'
