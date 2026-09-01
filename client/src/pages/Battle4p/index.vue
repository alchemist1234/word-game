<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad, onUnload, onBackPress } from '@dcloudio/uni-app'
import { useGameStore } from '../../store/game'
import GridBoard from '../../components/GridBoard.vue'
import type { CellPos } from '../../core/types'
import { queueMatch, matchQueueStatus, cancelMatchQueue, abandonMatch } from '../../api'
import { sendWs } from '../../api/socket'
import { playFail, playCombo } from '../../utils/sound'

const store = useGameStore()
const queuing = ref(false)
const queueError = ref('')
let queueTimer: ReturnType<typeof setInterval> | null = null

onLoad(async () => {
  store.clearBattle4pState()
  queuing.value = true
  queueError.value = ''
  try {
    await queueMatch({ size: 4 })
  } catch {
    queueError.value = '匹配入队失败，请重试'
    queuing.value = false
    return
  }
  queueTimer = setInterval(async () => {
    try {
      const res = await matchQueueStatus(4)
      if (res.status === 'matched') {
        stopQueue()
        if (res.grid && res.mySid) {
          // fallback: if no WS yet, apply via players
          // players may be in separate WS event; handle via queueStatus fallback
          if (res.players) {
            store.applyMatchStart4pData({
              matchId: res.matchId ?? '',
              grid: res.grid,
              size: res.size ?? 5,
              duration: res.duration ?? 180,
              mySid: res.mySid,
              players: res.players,
            })
            sendWs('match_join', { matchId: store.matchId })
          }
        }
      }
    } catch {}
  }, 1000)
})

function stopQueue() {
  if (queueTimer) { clearInterval(queueTimer); queueTimer = null }
  queuing.value = false
}
async function onCancel() {
  stopQueue()
  try { await cancelMatchQueue(4) } catch {}
  store.clearBattle4pState()
  uni.navigateBack()
}

const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null
const phase = computed(() => store.battle4pPhase)
watch(phase, (p) => {
  if (p === 'countdown') {
    countdown.value = 3
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0 && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    }, 1000)
  }
})

function onSelect(cell: CellPos) { store.selectCell(cell) }
function onRetreat() { store.retreat() }
function onSubmit() { store.submitSelection() }
function onClear() { store.clearSelection() }

const grid = computed(() => store.grid)
const foundCells = computed(() => {
  const set = new Set<string>()
  for (const fw of store.foundWords) for (const c of fw.cells) set.add(`${c.row},${c.col}`)
  return set
})
const RARITY_ORDER: Record<string, number> = { idiom: 0, rare: 1, normal: 2, common: 3 }
const sortedFoundWords = computed(() => [...store.foundWords].sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)))

const myScore = computed(() => store.score)
const players = computed(() => store.battle4pPlayers)
const remainingText = computed(() => {
  const m = Math.floor(store.battle4pRemaining / 60)
  const s = store.battle4pRemaining % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const COMBO_WINDOW = 10000
const comboCountdownMs = ref(0)
let comboInterval: ReturnType<typeof setInterval> | null = null
const comboBarWidth = computed(() => `${Math.max(0, (comboCountdownMs.value / COMBO_WINDOW) * 100)}%`)
function startComboCountdown() {
  comboCountdownMs.value = COMBO_WINDOW
  if (comboInterval) clearInterval(comboInterval)
  comboInterval = setInterval(() => {
    comboCountdownMs.value -= 100
    if (comboCountdownMs.value <= 0) { comboCountdownMs.value = 0; if (comboInterval) { clearInterval(comboInterval); comboInterval = null } }
  }, 100)
}
const failFlash = ref(false)
let failTimer: ReturnType<typeof setTimeout> | null = null
let feedbackTimer: ReturnType<typeof setTimeout> | null = null
watch(() => store.lastFeedback, (fb) => {
  if (!fb) return
  if (fb === 'success') {
    if (store.combo >= 1) playCombo(store.combo)
    startComboCountdown()
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => store.clearFeedback(), 800)
  } else if (fb === 'fail') {
    failFlash.value = true
    playFail()
    uni.vibrateShort({ type: 'light' })
    if (failTimer) clearTimeout(failTimer)
    failTimer = setTimeout(() => { failFlash.value = false; store.clearFeedback() }, 350)
  } else if (fb === 'duplicate') {
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => store.clearFeedback(), 600)
  }
})

const end = computed(() => store.battle4pEnd)

function onBackHome() {
  store.clearBattle4pState()
  store.resetMatch()
  uni.reLaunch({ url: '/pages/Home/index' })
}

onUnload(() => {
  if (queuing.value) void cancelMatchQueue(4)
  stopQueue()
  if (countdownTimer) clearInterval(countdownTimer)
})
onBackPress(() => {
  const active = queuing.value || (phase.value !== 'idle' && phase.value !== 'finished')
  if (active) {
    uni.showModal({
      title: '离开对战',
      content: queuing.value ? '确定要取消匹配并离开吗？' : '确定要离开当前对战吗？离开即判末位。',
      confirmText: queuing.value ? '离开' : '离开',
      cancelText: '继续',
      success: (res) => {
        if (res.confirm) {
          if (queuing.value) void cancelMatchQueue(4)
          else void abandonMatch().catch(() => {})
          store.clearBattle4pState()
          uni.navigateBack()
        }
      },
    })
    return true
  }
  return false
})
onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
  if (comboInterval) clearInterval(comboInterval)
  if (failTimer) clearTimeout(failTimer)
  if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<template>
  <view class="battle" :class="{ 'battle-fail': failFlash }">
    <view v-if="queuing" class="queuing">
      <view class="queuing-title">4人混战匹配中...</view>
      <view class="queuing-anim"><text class="queuing-dot">●</text><text class="queuing-dot">●</text><text class="queuing-dot">●</text></view>
      <view class="queue-tip">30秒内未满4人将由AI补位</view>
      <view v-if="queueError" class="queue-error">{{ queueError }}</view>
      <view class="cancel-btn" @tap="onCancel">取消匹配</view>
    </view>

    <view v-else-if="phase === 'countdown'" class="countdown-screen">
      <text class="countdown-num">{{ countdown > 0 ? countdown : '开战！' }}</text>
      <text class="countdown-opp">4人同网格竞技</text>
    </view>

    <view v-else-if="phase === 'playing'" class="playing">
      <view class="score-board-4p">
        <view v-for="p in players" :key="p.userId" class="side-4p" :class="{ mine: p.userId === store.mySid as unknown as number || p.nickname.includes('我') }">
          <text class="side-name-4p">{{ p.nickname }}<text v-if="p.isAi"> (AI)</text></text>
          <text class="side-score-4p">{{ p.score }}</text>
          <text class="side-rank-4p">#{{ p.rank || '-' }}</text>
        </view>
        <view class="timer-4p">{{ remainingText }}</view>
      </view>

      <view class="combo-bar" :class="{ 'combo-idle': store.combo === 0 }">
        <text v-if="store.combo > 0" class="combo-text">连击 ×{{ store.combo }}<text class="combo-mult">（本次 +{{ store.comboBonus }}分）</text></text>
        <view class="combo-track"><view class="combo-fill" :style="{ width: comboBarWidth }" /></view>
      </view>

      <view class="current-word">
        <text v-if="store.currentWord" class="word-text">{{ store.currentWord }}</text>
        <text v-else class="word-placeholder">滑动连接相邻汉字</text>
      </view>

      <view class="board-wrap">
        <GridBoard v-if="grid.length>0" :grid="grid" :selected-cells="store.selectedCells" :found-cells="foundCells" @select="onSelect" @retreat="onRetreat" @submit="onSubmit" @clear="onClear" />
      </view>

      <view class="found-words">
        <text v-if="sortedFoundWords.length===0" class="found-hint">已找到的词显示在这里</text>
        <text v-for="fw in sortedFoundWords" :key="fw.word" class="word-tag" :class="'tag-'+fw.rarity">{{ fw.word }}</text>
      </view>
    </view>

    <view v-else-if="phase === 'finished' && end" class="result">
      <text class="result-title" :class="end.won ? 'win' : 'lose'">{{ end.won ? '胜利！' : `第 ${end.myRank} 名` }}</text>
      <view class="result-scores">
        <view v-for="r in end.ranks" :key="r.userId" class="result-side">
          <text class="result-name">{{ r.userId < 0 ? `AI` : `玩家${r.userId}` }} #{{ r.rank }}</text>
          <text class="result-score">{{ r.score }}分</text>
        </view>
      </view>
      <view class="back-btn" @tap="onBackHome">返回大厅</view>
    </view>
  </view>
</template>

<style scoped>
.battle { min-height: 100vh; background: #f5f0e8; display: flex; flex-direction: column; transition: background 0.15s; }
.battle-fail { background: #f8d8d8; }
.queuing { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:40rpx; }
.queuing-title { font-size:40rpx; font-weight:bold; color:#3a2e2e; }
.queuing-anim { display:flex; gap:16rpx; }
.queuing-dot { font-size:32rpx; color:#e67e22; animation: pulse 1.2s infinite; }
.queuing-dot:nth-child(2){animation-delay:0.2s} .queuing-dot:nth-child(3){animation-delay:0.4s}
@keyframes pulse{0%,100%{opacity:0.2}50%{opacity:1}}
.queue-tip{font-size:24rpx;color:#8a7a6a}
.queue-error{font-size:28rpx;color:#d94a4a}
.cancel-btn{padding:20rpx 80rpx;border-radius:40rpx;font-size:30rpx;color:#fff;background:#d94a4a}
.countdown-screen{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32rpx}
.countdown-num{font-size:160rpx;font-weight:bold;color:#3a2e2e}
.countdown-opp{font-size:30rpx;color:#8a7a6a}
.playing{flex:1;display:flex;flex-direction:column;padding:24rpx 32rpx}
.score-board-4p{display:flex;flex-direction:row;flex-wrap:wrap;gap:12rpx;background:#fff;border-radius:16rpx;border:2rpx solid #d4c8b8;padding:16rpx}
.side-4p{flex:1 1 22%;display:flex;flex-direction:column;align-items:center;background:#faf6ef;border-radius:8rpx;padding:8rpx}
.side-name-4p{font-size:22rpx;color:#8a7a6a}
.side-score-4p{font-size:32rpx;font-weight:bold;color:#3a2e2e}
.side-rank-4p{font-size:20rpx;color:#e67e22}
.timer-4p{width:100%;text-align:center;font-size:30rpx;font-weight:bold;color:#d94a4a;margin-top:8rpx}
.combo-bar{width:100%;height:52rpx;margin-bottom:8rpx;overflow:hidden}
.combo-idle{visibility:hidden}
.combo-text{display:block;font-size:26rpx;line-height:34rpx;color:#d97a1e;font-weight:bold}
.combo-mult{font-size:22rpx;color:#d97a1e}
.combo-track{height:10rpx;background:#e8e0d0;border-radius:5rpx;margin-top:6rpx;overflow:hidden}
.combo-fill{height:100%;background:linear-gradient(90deg,#d97a1e,#f0a030);border-radius:5rpx;transition:width 0.1s linear}
.current-word{height:72rpx;display:flex;align-items:center;justify-content:center;margin:16rpx 0}
.word-text{font-size:40rpx;font-weight:bold;color:#3a2e2e;letter-spacing:8rpx}
.word-placeholder{font-size:28rpx;color:#b0a090}
.board-wrap{width:620rpx;height:620rpx;align-self:center;display:flex;justify-content:center;align-items:center}
.found-words{width:620rpx;max-height:150rpx;margin-top:16rpx;align-self:center;display:flex;flex-wrap:wrap;align-content:flex-start;overflow-y:auto}
.found-hint{font-size:22rpx;color:#b0a090;padding:8rpx 0}
.word-tag{font-size:22rpx;line-height:1.2;padding:4rpx 12rpx;margin:4rpx;border:1rpx solid;border-radius:8rpx;background:#fff}
.tag-idiom{color:#b8860b;border-color:#d4a017}
.tag-rare{color:#8e44ad;border-color:#8e44ad}
.tag-normal{color:#4a90d9;border-color:#4a90d9}
.tag-common{color:#6a5a4a;border-color:#b0a090}
.result{flex:1;display:flex;flex-direction:column;align-items:center;padding:60rpx 40rpx;gap:40rpx}
.result-title{font-size:72rpx;font-weight:bold}
.result-title.win{color:#d4a017}
.result-title.lose{color:#8a7a6a}
.result-scores{width:100%;display:flex;flex-direction:row;flex-wrap:wrap;gap:16rpx;background:#fff;border-radius:16rpx;border:2rpx solid #d4c8b8;padding:24rpx}
.result-side{flex:1 1 40%;display:flex;flex-direction:column;align-items:center;gap:8rpx}
.result-name{font-size:26rpx;color:#8a7a6a}
.result-score{font-size:36rpx;font-weight:bold;color:#3a2e2e}
.back-btn{margin-top:auto;padding:20rpx 100rpx;border-radius:40rpx;background:#4a90d9;color:#fff;font-size:30rpx}
</style>
