<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad, onUnload, onBackPress } from '@dcloudio/uni-app'
import { useGameStore } from '../../store/game'
import GridBoard from '../../components/GridBoard.vue'
import type { CellPos } from '../../core/types'
import { queueMatch, matchQueueStatus, cancelMatchQueue } from '../../api'

const store = useGameStore()

// ===== 匹配阶段（页面本地） =====
const queuing = ref(false)
const queueError = ref('')
let queueTimer: ReturnType<typeof setInterval> | null = null

onLoad(async () => {
  store.resetMatch()
  queuing.value = true
  queueError.value = ''
  try {
    await queueMatch()
  } catch (e) {
    queueError.value = '匹配入队失败，请稍后重试'
    queuing.value = false
    return
  }
  // 轮询状态：matched 后网格/对局数据由 WS match_start 推送
  queueTimer = setInterval(async () => {
    try {
      const res = await matchQueueStatus()
      if (res.status === 'timeout') {
        stopQueue()
        queueError.value = '未匹配到对手（30 秒超时），请重试'
      } else if (res.status === 'matched') {
        stopQueue()
        // WS match_start 广播优先；轮询兜底（WS 晚连/广播丢失场景）
        if (res.grid && res.mySid) {
          store.applyMatchStartData({
            matchId: res.matchId ?? '',
            grid: res.grid,
            size: res.size ?? 5,
            duration: res.duration ?? 180,
            mySid: res.mySid,
            opponent: res.opponent ?? { nickname: '对手', rankTier: 1 },
          })
        }
      }
    } catch {
      // 瞬时错误忽略，继续轮询
    }
  }, 1000)
})

function stopQueue() {
  if (queueTimer) {
    clearInterval(queueTimer)
    queueTimer = null
  }
  queuing.value = false
}

async function onCancel() {
  stopQueue()
  try {
    await cancelMatchQueue()
  } catch {
    // 忽略
  }
  store.resetMatch()
  uni.navigateBack()
}

// ===== 倒计时 =====
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const phase = computed(() => store.matchPhase)

watch(phase, (p) => {
  if (p === 'countdown') {
    // 本地 3-2-1（服务端 3s 后切 playing）
    countdown.value = 3
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0 && countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
    }, 1000)
  }
})

// ===== GridBoard 事件代理 =====
function onSelect(cell: CellPos) {
  store.selectCell(cell)
}
function onRetreat() {
  store.retreat()
}
function onSubmit() {
  store.submitSelection()
}
function onClear() {
  store.clearSelection()
}

const grid = computed(() => store.grid)
const foundCells = computed(() => {
  const set = new Set<string>()
  for (const fw of store.foundWords) {
    for (const c of fw.cells) set.add(`${c.row},${c.col}`)
  }
  return set
})

// ===== 对局数据 =====
const myScore = computed(() => store.score)
const oppScore = computed(() => store.opponent?.score ?? 0)
const oppNickname = computed(() => store.opponent?.nickname ?? '对手')
const remainingText = computed(() => {
  const m = Math.floor(store.matchRemaining / 60)
  const s = store.matchRemaining % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

// 对手得分飘字
const oppFloatVisible = ref(false)
const oppFloatText = ref('')
let oppFloatTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.opponentDelta,
  (d) => {
    if (d && d.delta > 0) {
      oppFloatText.value = `对手 +${d.delta}`
      oppFloatVisible.value = true
      if (oppFloatTimer) clearTimeout(oppFloatTimer)
      oppFloatTimer = setTimeout(() => {
        oppFloatVisible.value = false
      }, 1200)
    }
  },
)

// ===== 结算 =====
const end = computed(() => store.matchEnd)
const resultTitle = computed(() => {
  if (!end.value) return ''
  if (end.value.winnerUserId === null) return '平局'
  return end.value.won ? '胜利！' : '惜败'
})
const resultColor = computed(() => {
  if (!end.value) return ''
  if (end.value.winnerUserId === null) return 'draw'
  return end.value.won ? 'win' : 'lose'
})

function onBackHome() {
  store.resetMatch()
  uni.reLaunch({ url: '/pages/Home/index' })
}

onUnload(() => {
  if (queuing.value) {
    void cancelMatchQueue()
  }
  stopQueue()
  if (countdownTimer) clearInterval(countdownTimer)
  if (oppFloatTimer) clearTimeout(oppFloatTimer)
})

// 返回拦截：排队/对局中确认离开
onBackPress(() => {
  const active = queuing.value || (phase.value !== 'idle' && phase.value !== 'finished')
  if (active) {
    uni.showModal({
      title: '离开对战',
      content: '确定要离开当前对战吗？',
      confirmText: '离开',
      cancelText: '继续',
      success: (res) => {
        if (res.confirm) {
          if (queuing.value) void cancelMatchQueue()
          store.resetMatch()
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
})
</script>

<template>
  <view class="battle">
    <!-- 排队中 -->
    <view v-if="queuing" class="queuing">
      <view class="queuing-title">匹配中...</view>
      <view class="queuing-anim">
        <text class="queuing-dot">●</text>
        <text class="queuing-dot">●</text>
        <text class="queuing-dot">●</text>
      </view>
      <view v-if="queueError" class="queue-error">{{ queueError }}</view>
      <view v-if="queueError" class="retry-btn" @tap="onCancel">返回大厅</view>
      <view v-else class="cancel-btn" @tap="onCancel">取消匹配</view>
    </view>

    <!-- 开局倒计时 -->
    <view v-else-if="phase === 'countdown'" class="countdown-screen">
      <text class="countdown-num">{{ countdown > 0 ? countdown : '开战！' }}</text>
      <text class="countdown-opp">对手：{{ oppNickname }}</text>
    </view>

    <!-- 对局中 -->
    <view v-else-if="phase === 'playing'" class="playing">
      <view class="score-board">
        <view class="side">
          <text class="side-name">我</text>
          <text class="side-score">{{ myScore }}</text>
        </view>
        <view class="middle">
          <text class="timer">{{ remainingText }}</text>
          <view v-if="!store.wsConnected" class="reconnect-tip">连接断开，重连中...</view>
          <view class="opp-float" :class="{ 'opp-float-show': oppFloatVisible }">
            {{ oppFloatText }}
          </view>
        </view>
        <view class="side opp">
          <text class="side-name">{{ oppNickname }}</text>
          <text class="side-score">{{ oppScore }}</text>
        </view>
      </view>

      <view class="current-word">
        <text v-if="store.currentWord" class="word-text">{{ store.currentWord }}</text>
        <text v-else class="word-placeholder">滑动连接相邻汉字</text>
      </view>

      <view class="board-wrap">
        <GridBoard
          v-if="grid.length > 0"
          :grid="grid"
          :selected-cells="store.selectedCells"
          :found-cells="foundCells"
          @select="onSelect"
          @retreat="onRetreat"
          @submit="onSubmit"
          @clear="onClear"
        />
      </view>

      <view class="found-hint">
        <text>已找到 {{ store.foundWords.length }} 个词</text>
      </view>
    </view>

    <!-- 结算 -->
    <view v-else-if="phase === 'finished' && end" class="result">
      <text class="result-title" :class="resultColor">{{ resultTitle }}</text>
      <view class="result-scores">
        <view class="result-side">
          <text class="result-name">我</text>
          <text class="result-score">{{ end.my.score }} 分</text>
          <text class="result-sub">稀有 {{ end.my.rareCount }} · 连击峰值 {{ end.my.maxCombo }}</text>
        </view>
        <view class="result-vs">VS</view>
        <view class="result-side">
          <text class="result-name">{{ oppNickname }}</text>
          <text class="result-score">{{ end.opponent.score }} 分</text>
          <text class="result-sub">稀有 {{ end.opponent.rareCount }} · 连击峰值 {{ end.opponent.maxCombo }}</text>
        </view>
      </view>
      <view class="result-words">
        <text class="result-words-title">我找到的词</text>
        <view class="result-words-list">
          <text
            v-for="(fw, i) in end.my.foundWords"
            :key="i"
            class="result-word"
            :class="`w-${fw.rarity}`"
          >{{ fw.word }}</text>
          <text v-if="end.my.foundWords.length === 0" class="result-empty">没有找到词</text>
        </view>
      </view>
      <view class="back-btn" @tap="onBackHome">返回大厅</view>
    </view>
  </view>
</template>

<style scoped>
.battle {
  min-height: 100vh;
  background: #f5f0e8;
  display: flex;
  flex-direction: column;
}

/* 排队 */
.queuing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40rpx;
}
.queuing-title { font-size: 40rpx; font-weight: bold; color: #3a2e2e; }
.queuing-anim { display: flex; gap: 16rpx; }
.queuing-dot {
  font-size: 32rpx;
  color: #4a90d9;
  animation: pulse 1.2s infinite;
}
.queuing-dot:nth-child(2) { animation-delay: 0.2s; }
.queuing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
.queue-error { font-size: 28rpx; color: #d94a4a; }
.cancel-btn, .retry-btn {
  padding: 20rpx 80rpx;
  border-radius: 40rpx;
  font-size: 30rpx;
  color: #fff;
  background: #d94a4a;
}
.retry-btn { background: #4a90d9; }

/* 倒计时 */
.countdown-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32rpx;
}
.countdown-num { font-size: 160rpx; font-weight: bold; color: #3a2e2e; }
.countdown-opp { font-size: 30rpx; color: #8a7a6a; }

/* 对局 */
.playing { flex: 1; display: flex; flex-direction: column; padding: 24rpx 32rpx; }
.score-board {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: 16rpx;
  border: 2rpx solid #d4c8b8;
  padding: 24rpx 32rpx;
}
.side { display: flex; flex-direction: column; align-items: center; }
.side.opp { align-items: center; }
.side-name { font-size: 26rpx; color: #8a7a6a; }
.side-score { font-size: 48rpx; font-weight: bold; color: #3a2e2e; }
.middle { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.timer { font-size: 34rpx; font-weight: bold; color: #d94a4a; }
.reconnect-tip { font-size: 22rpx; color: #d94a4a; }
.opp-float {
  font-size: 24rpx;
  color: #4a90d9;
  opacity: 0;
  transition: opacity 0.3s;
}
.opp-float-show { opacity: 1; }

.current-word {
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 16rpx 0;
}
.word-text { font-size: 40rpx; font-weight: bold; color: #3a2e2e; letter-spacing: 8rpx; }
.word-placeholder { font-size: 28rpx; color: #b0a090; }

.board-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  margin: 0 auto;
}
.found-hint { text-align: center; font-size: 24rpx; color: #b0a090; padding: 12rpx 0; }

/* 结算 */
.result {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 40rpx;
  gap: 40rpx;
}
.result-title { font-size: 72rpx; font-weight: bold; }
.result-title.win { color: #d4a017; }
.result-title.lose { color: #8a7a6a; }
.result-title.draw { color: #4a90d9; }
.result-scores {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  background: #fff;
  border-radius: 16rpx;
  border: 2rpx solid #d4c8b8;
  padding: 32rpx 16rpx;
}
.result-side { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.result-name { font-size: 28rpx; color: #8a7a6a; }
.result-score { font-size: 44rpx; font-weight: bold; color: #3a2e2e; }
.result-sub { font-size: 22rpx; color: #b0a090; }
.result-vs { font-size: 32rpx; color: #d4c8b8; font-weight: bold; }
.result-words {
  width: 100%;
  background: #fff;
  border-radius: 16rpx;
  border: 2rpx solid #d4c8b8;
  padding: 24rpx;
}
.result-words-title { font-size: 28rpx; font-weight: bold; color: #3a2e2e; }
.result-words-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}
.result-word {
  padding: 8rpx 20rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
  background: #f0e8dc;
  color: #3a2e2e;
}
.result-word.w-idiom { background: #d4a017; color: #fff; }
.result-word.w-rare { background: #b06ad9; color: #fff; }
.result-empty { font-size: 24rpx; color: #b0a090; }
.back-btn {
  margin-top: auto;
  padding: 20rpx 100rpx;
  border-radius: 40rpx;
  background: #4a90d9;
  color: #fff;
  font-size: 30rpx;
}
</style>
