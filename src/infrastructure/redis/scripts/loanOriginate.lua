-- Collateralized loan: lock inv + optional plots, disburse gold from treasury reserve.
-- 50% over-collateralization enforced as: principal * 15 <= collateralValueGold * 10
-- KEYS[1] invKey
-- KEYS[2] invLockedKey
-- KEYS[3] walletKey
-- KEYS[4] treasuryReserveKey
-- KEYS[5] loanRecordKey (HASH)
-- KEYS[6] idempKey
-- KEYS[7] loanActiveKey (STRING -> current loanId)
-- KEYS[8] plotsKey
-- KEYS[9] plotsLockedKey
-- ARGV[1] loanId
-- ARGV[2] principal (gold)
-- ARGV[3] collateralValueGold (server-computed, inc. land)
-- ARGV[4] collateralInvSpec item:qty|item:qty (may be empty)
-- ARGV[5] collateralPlotCsv 0,1,2 (may be empty)
-- ARGV[6] idempTtlSec
-- ARGV[7] userId
-- ARGV[8] tsMs
-- ARGV[9] borrowedAtMs
-- ARGV[10] dueAtMs

local cached = redis.call('GET', KEYS[6])
if cached then
  return cached
end

local active = redis.call('GET', KEYS[7])
if active then
  return redis.error_reply('ERR_LOAN_ACTIVE')
end

local principal = tonumber(ARGV[2])
local collVal = tonumber(ARGV[3])
if not principal or principal < 1 or not collVal or collVal < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

if principal * 15 > collVal * 10 then
  return redis.error_reply('ERR_LTV')
end

local reserve = tonumber(redis.call('GET', KEYS[4]) or '0') or 0
if reserve < principal then
  return redis.error_reply('ERR_TREASURY_DEPLETED')
end

local invSpec = ARGV[4]
if invSpec ~= '' then
  for chunk in string.gmatch(invSpec, '([^|]+)') do
    local item, qtys = string.match(chunk, '^([^:]+):(%d+)$')
    if not item or not qtys then
      return redis.error_reply('ERR_BAD_SPEC')
    end
    local q = tonumber(qtys)
    if not q or q < 1 then
      return redis.error_reply('ERR_BAD_SPEC')
    end
    local have = tonumber(redis.call('HGET', KEYS[1], item) or '0') or 0
    if have < q then
      return redis.error_reply('ERR_INSUFFICIENT_INV')
    end
    redis.call('HINCRBY', KEYS[1], item, -q)
    redis.call('HINCRBY', KEYS[2], item, q)
  end
end

local plotCsv = ARGV[5]
if plotCsv ~= '' then
  for pid in string.gmatch(plotCsv, '([^,]+)') do
    if redis.call('SISMEMBER', KEYS[8], pid) == 0 then
      return redis.error_reply('ERR_PLOT_NOT_OWNED')
    end
    redis.call('SREM', KEYS[8], pid)
    redis.call('SADD', KEYS[9], pid)
  end
end

redis.call('DECRBY', KEYS[4], principal)
redis.call('HINCRBY', KEYS[3], 'gold', principal)

redis.call('HSET', KEYS[5],
  'status', 'active',
  'principal', ARGV[2],
  'borrowedAtMs', ARGV[9],
  'dueAtMs', ARGV[10],
  'collateralInv', ARGV[4],
  'collateralPlots', ARGV[5],
  'collateralValueGold', ARGV[3]
)

redis.call('SET', KEYS[7], ARGV[1])

local payload = table.concat({'OK', ARGV[1], ARGV[2]}, '|')
redis.call('SET', KEYS[6], payload, 'EX', ARGV[6])
return payload
