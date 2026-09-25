/**
 * Redis Lua 脚本：提词计分必须在服务端原子完成。
 * 读改写分离会导致并发请求同时通过 duplicate 检查并覆盖分数。
 */
export const SUBMIT_WORD_SCRIPT = `
local sessionKey = KEYS[1]
local foundKey = KEYS[2]
local endLockKey = KEYS[3]

local word = ARGV[1]
local baseScore = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local comboWindow = tonumber(ARGV[4])
local maxCombo = tonumber(ARGV[5])
local potentialCount = tonumber(ARGV[6])
local deadlineAt = tonumber(ARGV[7])
local sessionTtl = tonumber(ARGV[8])

if redis.call('EXISTS', endLockKey) == 1 then
  return {'settling'}
end

local raw = redis.call('HGETALL', sessionKey)
if #raw == 0 then
  return {'missing'}
end

local fields = {}
for i = 1, #raw, 2 do
  fields[raw[i]] = raw[i + 1]
end

local currentPotentialCount = tonumber(fields['potentialCount']) or potentialCount or 0
local currentDeadlineAt = tonumber(fields['deadlineAt']) or deadlineAt or 0
local settlingUntil = tonumber(fields['settleLockUntil']) or 0

if fields['settling'] == '1' and settlingUntil > now then
  return {'settling'}
end
if fields['settled'] == '1' then
  return {'settled'}
end
if currentDeadlineAt > 0 and now > currentDeadlineAt then
  return {'expired'}
end
if redis.call('SISMEMBER', foundKey, word) == 1 then
  return {'duplicate'}
end

local lastWordAt = tonumber(fields['lastWordAt']) or 0
local combo = 0
if lastWordAt > 0 and now - lastWordAt <= comboWindow then
  combo = (tonumber(fields['combo']) or 0) + 1
  if combo > maxCombo then
    combo = maxCombo
  end
end

local comboBonus = 0
if combo >= 9 then
  comboBonus = 3
elseif combo >= 6 then
  comboBonus = 2
elseif combo >= 3 then
  comboBonus = 1
end

local delta = baseScore + comboBonus
if fields['nextDouble'] == '1' then
  delta = delta * 2
end

local currentScore = tonumber(fields['score']) or 0
local currentComboScore = tonumber(fields['comboScore']) or 0
local newScore = currentScore + delta
local newMaxCombo = tonumber(fields['maxCombo']) or 0
if combo > newMaxCombo then
  newMaxCombo = combo
end

redis.call('SADD', foundKey, word)
redis.call('HSET', sessionKey,
  'score', tostring(newScore),
  'comboScore', tostring(currentComboScore + comboBonus),
  'combo', tostring(combo),
  'maxCombo', tostring(newMaxCombo),
  'lastWordAt', tostring(now)
)
if fields['nextDouble'] == '1' then
  redis.call('HSET', sessionKey, 'nextDouble', '0')
end
redis.call('EXPIRE', sessionKey, sessionTtl)
redis.call('EXPIRE', foundKey, sessionTtl)

local foundCount = redis.call('SCARD', foundKey)
local perfect = 0
local perfectBonus = 0
local remainingSec = 0
local totalScore = newScore
if (fields['matchId'] == nil or fields['matchId'] == '') and
   currentPotentialCount > 0 and foundCount >= currentPotentialCount then
  remainingSec = math.floor((currentDeadlineAt - now) / 1000)
  if remainingSec < 0 then
    remainingSec = 0
  end
  perfectBonus = remainingSec * 3 + 50
  totalScore = newScore + perfectBonus
  perfect = 1
  redis.call('HSET', sessionKey,
    'score', tostring(totalScore),
    'isPerfect', '1',
    'perfectBonus', tostring(perfectBonus)
  )
end

return {
  'ok',
  tostring(delta),
  tostring(totalScore),
  tostring(combo),
  tostring(comboBonus),
  tostring(foundCount),
  tostring(perfect),
  tostring(perfectBonus),
  tostring(remainingSec),
  fields['matchId'] or ''
}
`

export const ASSERT_END_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] and
   redis.call('HGET', KEYS[2], 'settleLockToken') == ARGV[1] then
  return 1
end
return 0
`

export const COMMIT_SETTLEMENT_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return {'fenced'}
end
if redis.call('HGET', KEYS[2], 'settleLockToken') ~= ARGV[1] then
  return {'fenced'}
end
redis.call('SET', KEYS[3], ARGV[2], 'EX', tonumber(ARGV[3]))
redis.call('HSET', KEYS[2], 'settled', '1')
redis.call('HDEL', KEYS[2], 'settling', 'settleLockToken', 'settleLockUntil')
return {'ok'}
`

export const FINALIZE_CACHED_SETTLEMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 0 then
  return {'missing'}
end
redis.call('HSET', KEYS[1], 'settled', '1')
redis.call('HDEL', KEYS[1], 'settling', 'settleLockToken', 'settleLockUntil')
return {'ok'}
`

export const UPDATE_LEADERBOARD_SCRIPT = `
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
local incoming = tonumber(ARGV[2])
if not current or incoming > tonumber(current) then
  redis.call('ZADD', KEYS[1], incoming, ARGV[1])
  return 1
end
return 0
`

export const RENEW_END_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  if redis.call('EXISTS', KEYS[2]) == 0 then
    return 0
  end
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  redis.call('HSET', KEYS[2], 'settleLockUntil', ARGV[3])
  return 1
end
return 0
`

export const RELEASE_END_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('HDEL', KEYS[2], 'settling', 'settleLockUntil', 'settleLockToken')
  return 1
end
return 0
`
