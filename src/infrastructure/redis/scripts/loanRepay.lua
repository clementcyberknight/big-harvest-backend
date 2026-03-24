-- Repay loan: gold back to treasury, unlock collateral. Amount due computed in Node.
-- KEYS[1] invKey
-- KEYS[2] invLockedKey
-- KEYS[3] walletKey
-- KEYS[4] treasuryReserveKey
-- KEYS[5] loanRecordKey
-- KEYS[6] idempKey
-- KEYS[7] loanActiveKey
-- KEYS[8] plotsKey
-- KEYS[9] plotsLockedKey
-- ARGV[1] loanId
-- ARGV[2] totalDueGold
-- ARGV[3] idempTtlSec
-- ARGV[4] userId
-- ARGV[5] tsMs

local cached = redis.call('GET', KEYS[6])
if cached then
  return cached
end

local cur = redis.call('GET', KEYS[7])
if not cur or cur ~= ARGV[1] then
  return redis.error_reply('ERR_LOAN_MISMATCH')
end

local st = redis.call('HGET', KEYS[5], 'status')
if st ~= 'active' then
  return redis.error_reply('ERR_LOAN_NOT_ACTIVE')
end

local due = tonumber(ARGV[2])
if not due or due < 1 then
  return redis.error_reply('ERR_BAD_ARGS')
end

local bal = tonumber(redis.call('HGET', KEYS[3], 'gold') or '0') or 0
if bal < due then
  return redis.error_reply('ERR_INSUFFICIENT_GOLD')
end

redis.call('HINCRBY', KEYS[3], 'gold', -due)
redis.call('INCRBY', KEYS[4], due)

local invSpec = redis.call('HGET', KEYS[5], 'collateralInv') or ''
if invSpec ~= '' then
  for chunk in string.gmatch(invSpec, '([^|]+)') do
    local item, qtys = string.match(chunk, '^([^:]+):(%d+)$')
    if item and qtys then
      local q = tonumber(qtys)
      if q and q > 0 then
        local locked = tonumber(redis.call('HGET', KEYS[2], item) or '0') or 0
        if locked < q then
          return redis.error_reply('ERR_LOCKED_MISMATCH')
        end
        redis.call('HINCRBY', KEYS[2], item, -q)
        redis.call('HINCRBY', KEYS[1], item, q)
      end
    end
  end
end

local plotCsv = redis.call('HGET', KEYS[5], 'collateralPlots') or ''
if plotCsv ~= '' then
  for pid in string.gmatch(plotCsv, '([^,]+)') do
    if redis.call('SISMEMBER', KEYS[9], pid) == 1 then
      redis.call('SREM', KEYS[9], pid)
      redis.call('SADD', KEYS[8], pid)
    end
  end
end

redis.call('HSET', KEYS[5],
  'status', 'repaid',
  'repaidAtMs', ARGV[5],
  'repaidGold', ARGV[2]
)
redis.call('DEL', KEYS[7])

local payload = table.concat({'OK', ARGV[1], ARGV[2]}, '|')
redis.call('SET', KEYS[6], payload, 'EX', ARGV[3])
return payload
