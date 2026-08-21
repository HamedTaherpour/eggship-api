import { OTP_REDIS_KEY_PREFIX } from './otp-redis-keys';

/**
 * Atomic OTP challenge create with resend cooldown (SET NX) and replacement of
 * any prior active challenge for the same phone fingerprint.
 *
 * KEYS[1] cooldown key
 * KEYS[2] active challenge pointer for phone
 * KEYS[3] new challenge hash key
 *
 * ARGV[1..9] cooldownTtl, challengeTtl, challengeId, phone, purpose, codeDigest,
 *            maxAttempts, createdAtUnixMs, expiresAtUnixMs
 * ARGV[10] challenge key prefix
 * ARGV[11] phoneFingerprint (for active-pointer cleanup on consume)
 */
export const OTP_CREATE_CHALLENGE_LUA = `
local cooldownKey = KEYS[1]
local activeKey = KEYS[2]
local challengeKey = KEYS[3]

local cooldownTtl = tonumber(ARGV[1])
local challengeTtl = tonumber(ARGV[2])
local challengeId = ARGV[3]
local phone = ARGV[4]
local purpose = ARGV[5]
local codeDigest = ARGV[6]
local maxAttempts = ARGV[7]
local createdAt = ARGV[8]
local expiresAt = ARGV[9]
local challengePrefix = ARGV[10]
local phoneFingerprint = ARGV[11]

local setCooldown = redis.call('SET', cooldownKey, '1', 'EX', cooldownTtl, 'NX')
if not setCooldown then
  local ttl = redis.call('TTL', cooldownKey)
  if ttl < 0 then
    ttl = cooldownTtl
  end
  return {0, ttl}
end

local previousChallengeId = redis.call('GET', activeKey)
if type(previousChallengeId) == 'string' and previousChallengeId ~= '' then
  redis.call('DEL', challengePrefix .. previousChallengeId)
end

redis.call(
  'HSET', challengeKey,
  'challengeId', challengeId,
  'phone', phone,
  'phoneFingerprint', phoneFingerprint,
  'purpose', purpose,
  'codeDigest', codeDigest,
  'attempts', '0',
  'maxAttempts', maxAttempts,
  'createdAtUnixMs', createdAt,
  'expiresAtUnixMs', expiresAt
)
redis.call('EXPIRE', challengeKey, challengeTtl)
redis.call('SET', activeKey, challengeId, 'EX', challengeTtl)

if type(previousChallengeId) == 'string' and previousChallengeId ~= '' then
  return {1, previousChallengeId}
end
return {1, ''}
`.trim();

/**
 * Atomic verify + consume / attempt increment.
 *
 * KEYS[1] challenge hash key
 * KEYS[2] consumed marker key for this challengeId
 *
 * ARGV[1] expected codeDigest
 * ARGV[2] nowUnixMs
 * ARGV[3] key prefix (eggship:auth:otp:v1)
 * ARGV[4] consumed marker TTL seconds (remaining challenge lifetime bound)
 *
 * Returns:
 * matched | mismatch | locked | missing | expired | already_used
 */
export const OTP_CONSUME_CHALLENGE_LUA = `
local challengeKey = KEYS[1]
local consumedKey = KEYS[2]
local expectedDigest = ARGV[1]
local nowMs = tonumber(ARGV[2])
local keyPrefix = ARGV[3]
local consumedTtl = tonumber(ARGV[4])

if redis.call('EXISTS', challengeKey) == 0 then
  if redis.call('EXISTS', consumedKey) == 1 then
    return {'already_used'}
  end
  return {'missing'}
end

local digest = redis.call('HGET', challengeKey, 'codeDigest')
local attempts = tonumber(redis.call('HGET', challengeKey, 'attempts') or '0')
local maxAttempts = tonumber(redis.call('HGET', challengeKey, 'maxAttempts') or '0')
local expiresAt = tonumber(redis.call('HGET', challengeKey, 'expiresAtUnixMs') or '0')
local challengeId = redis.call('HGET', challengeKey, 'challengeId')
local phone = redis.call('HGET', challengeKey, 'phone')
local phoneFingerprint = redis.call('HGET', challengeKey, 'phoneFingerprint')
local purpose = redis.call('HGET', challengeKey, 'purpose')
local createdAt = redis.call('HGET', challengeKey, 'createdAtUnixMs')

local activeKey = ''
if type(phoneFingerprint) == 'string' and phoneFingerprint ~= '' then
  activeKey = keyPrefix .. ':phone:' .. phoneFingerprint .. ':active'
end

local function clearActive()
  if activeKey ~= '' and redis.call('GET', activeKey) == challengeId then
    redis.call('DEL', activeKey)
  end
end

if expiresAt > 0 and nowMs >= expiresAt then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'expired'}
end

if attempts >= maxAttempts then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'locked'}
end

if digest == expectedDigest then
  local ttl = consumedTtl
  if expiresAt > nowMs then
    local remaining = math.floor((expiresAt - nowMs) / 1000)
    if remaining > 0 then
      ttl = remaining
    end
  end
  if ttl < 1 then
    ttl = 1
  end
  redis.call('SET', consumedKey, '1', 'EX', ttl)
  redis.call('DEL', challengeKey)
  clearActive()
  return {
    'matched',
    challengeId,
    phone,
    purpose,
    digest,
    tostring(attempts),
    tostring(maxAttempts),
    createdAt,
    tostring(expiresAt)
  }
end

attempts = attempts + 1
if attempts >= maxAttempts then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'locked'}
end

redis.call('HSET', challengeKey, 'attempts', tostring(attempts))
local remaining = maxAttempts - attempts
return {'mismatch', tostring(attempts), tostring(remaining)}
`.trim();

/**
 * Same as OTP_CONSUME_CHALLENGE_LUA, but on match also writes the verification
 * grant hash + TTL in the same script so the challenge is never burned without
 * a grant.
 *
 * KEYS[1] challenge hash key
 * KEYS[2] consumed marker key for this challengeId
 * KEYS[3] verification grant hash key
 *
 * ARGV[1] expected codeDigest
 * ARGV[2] nowUnixMs
 * ARGV[3] key prefix
 * ARGV[4] consumed marker TTL seconds
 * ARGV[5] grantId
 * ARGV[6] grantTtlSeconds
 * ARGV[7] grantCreatedAtUnixMs
 * ARGV[8] grantExpiresAtUnixMs
 */
export const OTP_CONSUME_AND_MINT_GRANT_LUA = `
local challengeKey = KEYS[1]
local consumedKey = KEYS[2]
local grantKey = KEYS[3]
local expectedDigest = ARGV[1]
local nowMs = tonumber(ARGV[2])
local keyPrefix = ARGV[3]
local consumedTtl = tonumber(ARGV[4])
local grantId = ARGV[5]
local grantTtl = tonumber(ARGV[6])
local grantCreatedAt = ARGV[7]
local grantExpiresAt = ARGV[8]

if redis.call('EXISTS', challengeKey) == 0 then
  if redis.call('EXISTS', consumedKey) == 1 then
    return {'already_used'}
  end
  return {'missing'}
end

local digest = redis.call('HGET', challengeKey, 'codeDigest')
local attempts = tonumber(redis.call('HGET', challengeKey, 'attempts') or '0')
local maxAttempts = tonumber(redis.call('HGET', challengeKey, 'maxAttempts') or '0')
local expiresAt = tonumber(redis.call('HGET', challengeKey, 'expiresAtUnixMs') or '0')
local challengeId = redis.call('HGET', challengeKey, 'challengeId')
local phone = redis.call('HGET', challengeKey, 'phone')
local phoneFingerprint = redis.call('HGET', challengeKey, 'phoneFingerprint')
local purpose = redis.call('HGET', challengeKey, 'purpose')
local createdAt = redis.call('HGET', challengeKey, 'createdAtUnixMs')

local activeKey = ''
if type(phoneFingerprint) == 'string' and phoneFingerprint ~= '' then
  activeKey = keyPrefix .. ':phone:' .. phoneFingerprint .. ':active'
end

local function clearActive()
  if activeKey ~= '' and redis.call('GET', activeKey) == challengeId then
    redis.call('DEL', activeKey)
  end
end

if expiresAt > 0 and nowMs >= expiresAt then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'expired'}
end

if attempts >= maxAttempts then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'locked'}
end

if digest == expectedDigest then
  local ttl = consumedTtl
  if expiresAt > nowMs then
    local remaining = math.floor((expiresAt - nowMs) / 1000)
    if remaining > 0 then
      ttl = remaining
    end
  end
  if ttl < 1 then
    ttl = 1
  end

  redis.call(
    'HSET', grantKey,
    'grantId', grantId,
    'phone', phone,
    'purpose', purpose,
    'challengeId', challengeId,
    'createdAtUnixMs', grantCreatedAt,
    'expiresAtUnixMs', grantExpiresAt
  )
  redis.call('EXPIRE', grantKey, grantTtl)

  redis.call('SET', consumedKey, '1', 'EX', ttl)
  redis.call('DEL', challengeKey)
  clearActive()
  return {
    'matched',
    challengeId,
    phone,
    purpose,
    digest,
    tostring(attempts),
    tostring(maxAttempts),
    createdAt,
    tostring(expiresAt),
    grantId,
    grantExpiresAt
  }
end

attempts = attempts + 1
if attempts >= maxAttempts then
  redis.call('DEL', challengeKey)
  clearActive()
  return {'locked'}
end

redis.call('HSET', challengeKey, 'attempts', tostring(attempts))
local remaining = maxAttempts - attempts
return {'mismatch', tostring(attempts), tostring(remaining)}
`.trim();

/**
 * Atomic verification-grant create with TTL.
 *
 * KEYS[1] grant hash key
 * ARGV[1..6] grantId, phone, purpose, challengeId, createdAtUnixMs, expiresAtUnixMs
 * ARGV[7] ttlSeconds
 */
export const OTP_CREATE_VERIFICATION_GRANT_LUA = `
local grantKey = KEYS[1]
redis.call(
  'HSET', grantKey,
  'grantId', ARGV[1],
  'phone', ARGV[2],
  'purpose', ARGV[3],
  'challengeId', ARGV[4],
  'createdAtUnixMs', ARGV[5],
  'expiresAtUnixMs', ARGV[6]
)
redis.call('EXPIRE', grantKey, tonumber(ARGV[7]))
return 1
`.trim();

/**
 * Atomic fixed-window counter with TTL on first increment.
 *
 * KEYS[1] counter key
 * ARGV[1] limit
 * ARGV[2] window seconds
 *
 * Returns: { allowed = 1|0, count, ttl }
 */
export const OTP_RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, windowSeconds)
end

local ttl = redis.call('TTL', key)
if ttl < 0 then
  redis.call('EXPIRE', key, windowSeconds)
  ttl = windowSeconds
end

if count > limit then
  return {0, count, ttl}
end
return {1, count, ttl}
`.trim();

export const OTP_DELETE_CHALLENGE_LUA = `
local challengeKey = KEYS[1]
local activeKey = KEYS[2]
local challengeId = ARGV[1]

redis.call('DEL', challengeKey)
if redis.call('GET', activeKey) == challengeId then
  redis.call('DEL', activeKey)
end
return 1
`.trim();

export const OTP_CHALLENGE_KEY_PREFIX = `${OTP_REDIS_KEY_PREFIX}:challenge:`;

export function otpConsumedKey(challengeId: string): string {
  return `${OTP_REDIS_KEY_PREFIX}:consumed:${challengeId}`;
}

/**
 * Atomically consume a verification grant.
 *
 * KEYS[1] grant hash key
 * KEYS[2] consumed marker key
 * ARGV[1] nowUnixMs
 * ARGV[2] consumed marker TTL seconds
 *
 * Returns status arrays compatible with ConsumeOtpVerificationGrantOutcome.
 */
export const OTP_CONSUME_VERIFICATION_GRANT_LUA = `
local grantKey = KEYS[1]
local consumedKey = KEYS[2]
local nowUnixMs = tonumber(ARGV[1])
local consumedTtl = tonumber(ARGV[2])

if redis.call('EXISTS', consumedKey) == 1 then
  return {'already_used'}
end

local values = redis.call(
  'HMGET', grantKey,
  'grantId', 'phone', 'purpose', 'challengeId', 'createdAtUnixMs', 'expiresAtUnixMs'
)
local grantId = values[1]
if type(grantId) ~= 'string' or grantId == '' then
  return {'missing'}
end

local expiresAt = tonumber(values[6])
if expiresAt == nil or nowUnixMs >= expiresAt then
  redis.call('DEL', grantKey)
  return {'expired'}
end

redis.call('DEL', grantKey)
redis.call('SET', consumedKey, '1', 'EX', consumedTtl)

return {
  'matched',
  values[1],
  values[2],
  values[3],
  values[4],
  values[5],
  values[6]
}
`.trim();
