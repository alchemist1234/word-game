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
          // 刷新/重入场景：向房间重新声明在线，清除 30s 断线宽限定时器并重补状态
          // （与 connectWs 重连回调互补：若 WS 在 apply 后才连上由回调补齐）
          sendWs('match_join', { matchId: store.matchId })
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

// 已找到词按稀有度从高到低排序（与单人闯关一致）
const RARITY_ORDER: Record<string, number> = {
  idiom: 0,
  rare: 1,
  normal: 2,
  common: 3,
}
const sortedFoundWords = computed(() =>
  [...store.foundWords].sort(
    (a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9),
  ),
)

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

// ===== 反馈与连击（对齐单人闯关 Game 页：错词红闪 + 连击加分/倒计时） =====
// 连击倒计时（本地 UI 显示，服务端权威判定一致性）
const COMBO_WINDOW = 10000
const comboCountdownMs = ref(0)
let comboInterval: ReturnType<typeof setInterval> | null = null

const comboBarWidth = computed(
  () => `${Math.max(0, (comboCountdownMs.value / COMBO_WINDOW) * 100)}%`,
)

function startComboCountdown() {
  comboCountdownMs.value = COMBO_WINDOW
  if (comboInterval) clearInterval(comboInterval)
  comboInterval = setInterval(() => {
    comboCountdownMs.value -= 100
    if (comboCountdownMs.value <= 0) {
      comboCountdownMs.value = 0
      if (comboInterval) {
        clearInterval(comboInterval)
        comboInterval = null
      }
    }
  }, 100)
}

const failFlash = ref(false)
let failTimer: ReturnType<typeof setTimeout> | null = null
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => store.lastFeedback,
  (fb) => {
    if (!fb) return
    if (fb === 'success') {
      // 连击 >=1 时播连击音阶 + 重启倒计时进度条（与单人闯关一致）
      if (store.combo >= 1) playCombo(store.combo)
      startComboCountdown()
      if (feedbackTimer) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(() => store.clearFeedback(), 800)
    } else if (fb === 'fail') {
      // 错词：背景红色闪烁 + 低音 + 轻震动
      failFlash.value = true
      playFail()
      uni.vibrateShort({ type: 'light' })
      if (failTimer) clearTimeout(failTimer)
      failTimer = setTimeout(() => {
        failFlash.value = false
        store.clearFeedback()
      }, 350)
    } else if (fb === 'duplicate') {
      if (feedbackTimer) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(() => store.clearFeedback(), 600)
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
// 对方认输/掉线判负：分数低仍获胜时的明确提示，避免误解
const forfeitTipText = computed(() => {
  if (!end.value?.opponentForfeit) return ''
  return end.value.forfeitReason === 'disconnect'
    ? '对方掉线，本局判胜'
    : '对方认输，本局胜利'
})
const forfeitBadgeText = computed(() =>
  end.value?.forfeitReason === 'disconnect' ? '掉线' : '认输',
)

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

// 返回拦截：排队/对局中确认离开（对局中主动离开 = 判负，对方直接获胜）
onBackPress(() => {
  const active = queuing.value || (phase.value !== 'idle' && phase.value !== 'finished')
  if (active) {
    uni.showModal({
      title: '离开对战',
      content: queuing.value
        ? '确定要取消匹配并离开吗？'
        : '确定要离开当前对战吗？离开即判负，对手直接获胜。',
      confirmText: queuing.value ? '离开' : '认输离开',
      cancelText: '继续',
      success: (res) => {
        if (res.confirm) {
          if (queuing.value) {
            void cancelMatchQueue()
          } else {
            // 主动离开：服务端立即结束对局并判对方胜利（不管当前得分）
            void abandonMatch().catch(() => {})
          }
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
  if (comboInterval) clearInterval(comboInterval)
  if (failTimer) clearTimeout(failTimer)
  if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<template>
  <view class="battle" :class="{ 'battle-fail': failFlash }">
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

      <view class="combo-bar" :class="{ 'combo-idle': store.combo === 0 }">
        <text v-if="store.combo > 0" class="combo-text">
          连击 ×{{ store.combo }}<text class="combo-mult">（本次 +{{ store.comboBonus }}分）</text>
        </text>
        <view class="combo-track">
          <view class="combo-fill" :style="{ width: comboBarWidth }" />
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

      <view class="found-words">
        <text v-if="sortedFoundWords.length === 0" class="found-hint">
          已找到的词显示在这里
        </text>
        <text
          v-for="fw in sortedFoundWords"
          :key="fw.word"
          class="word-tag"
          :class="'tag-' + fw.rarity"
        >{{ fw.word }}</text>
      </view>
    </view>

    <!-- 结算 -->
    <view v-else-if="phase === 'finished' && end" class="result">
      <text class="result-title" :class="resultColor">{{ resultTitle }}</text>
      <view v-if="end.opponentForfeit" class="forfeit-tip">{{ forfeitTipText }}</view>
      <view class="result-scores">
        <view class="result-side">
          <text class="result-name">我</text>
          <text class="result-score">{{ end.my.score }} 分</text>
          <text class="result-sub">稀有 {{ end.my.rareCount }} · 连击峰值 {{ end.my.maxCombo }}</text>
        </view>
        <view class="result-vs">VS</view>
        <view class="result-side">
          <view class="result-name-row">
            <text class="result-name">{{ oppNickname }}</text>
            <text v-if="end.opponentForfeit" class="forfeit-badge">{{ forfeitBadgeText }}</text>
          </view>
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
  transition: background 0.15s;
}
.battle-fail {
  background: #f8d8d8;
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

.combo-bar {
  width: 100%;
  height: 52rpx; /* 固定高度占位：连击条显隐不影响网格布局，避免命中错位 */
  margin-bottom: 8rpx;
  overflow: hidden;
}
.combo-idle {
  visibility: hidden; /* 无连击时内容隐藏但保留高度 */
}
.combo-text {
  display: block;
  font-size: 26rpx;
  line-height: 34rpx; /* 固定行高，防止文本溢出被 height/overflow 裁剪 */
  color: #d97a1e;
  font-weight: bold;
}
.combo-mult {
  font-size: 22rpx;
  color: #d97a1e;
}
.combo-track {
  height: 10rpx;
  background: #e8e0d0;
  border-radius: 5rpx;
  margin-top: 6rpx;
  overflow: hidden;
}
.combo-fill {
  height: 100%;
  background: linear-gradient(90deg, #d97a1e, #f0a030);
  border-radius: 5rpx;
  transition: width 0.1s linear;
}

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
  width: 620rpx;
  height: 620rpx;
  align-self: center;
  display: flex;
  justify-content: center;
  align-items: center;
}
.found-words {
  width: 620rpx;
  max-height: 150rpx;
  margin-top: 16rpx;
  align-self: center;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  overflow-y: auto;
}
.found-hint { font-size: 22rpx; color: #b0a090; padding: 8rpx 0; }
.word-tag {
  font-size: 22rpx;
  line-height: 1.2;
  padding: 4rpx 12rpx;
  margin: 4rpx;
  border: 1rpx solid;
  border-radius: 8rpx;
  background: #ffffff;
}
.tag-idiom {
  color: #b8860b;
  border-color: #d4a017;
}
.tag-rare {
  color: #8e44ad;
  border-color: #8e44ad;
}
.tag-normal {
  color: #4a90d9;
  border-color: #4a90d9;
}
.tag-common {
  color: #6a5a4a;
  border-color: #b0a090;
}

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
.forfeit-tip {
  font-size: 26rpx;
  color: #d94a4a;
  background: #fdeaea;
  border: 1rpx solid #f2c4c4;
  border-radius: 24rpx;
  padding: 10rpx 28rpx;
}
.result-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
}
.forfeit-badge {
  font-size: 20rpx;
  color: #fff;
  background: #d94a4a;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}
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
