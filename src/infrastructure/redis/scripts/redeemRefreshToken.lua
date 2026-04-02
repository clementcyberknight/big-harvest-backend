-- Atomic refresh token redemption.
-- KEYS[1] = storage key (ravolo:auth:rt:<hash>)
-- KEYS[2] = used marker key (ravolo:auth:rt_used:<hash>)
-- KEYS[3] = revoked marker key (ravolo:auth:rt_revoked:<hash>)
-- ARGV[1] = used marker TTL in seconds
--
-- Returns:
--   "REVOKED"  — token was explicitly revoked (logout)
--   "USED"     — token was already redeemed (reuse attempt)
--   "NOTFOUND" — token key missing (expired or never existed)
--   <payload>  — JSON payload string on success (token atomically consumed)

local revoked = redis.call('GET', KEYS[3])
if revoked == '1' then
  return 'REVOKED'
end

local used = redis.call('GET', KEYS[2])
if used then
  return 'USED'
end

local val = redis.call('GETDEL', KEYS[1])
if not val then
  return 'NOTFOUND'
end

-- Mark as used so concurrent/replay attempts are detected.
-- NX prevents overwriting if a parallel script already set it.
redis.call('SET', KEYS[2], val, 'EX', tonumber(ARGV[1]), 'NX')

return val
