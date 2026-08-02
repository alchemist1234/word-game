<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { onShow, onBackPress, onUnload } from '@dcloudio/uni-app'
import { useGameStore } from '../../store/game'
import GridBoard from '../../components/GridBoard.vue'
import type { CellPos } from '../../core/types'
import { playSuccess, playIdiom, playFail, playCombo } from '../../utils/sound'

const store = useGameStore()

// 进入页面确保对局进行中
onShow(() => {
  if (store.phase !== 'playing') {
    // 闯关模式：从路由参数取 levelId
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1] as
      | { options?: { levelId?: string } }
      | undefined
    const levelId = currentPage?.options?.levelId
    if (levelId) {
      store.startLevel(levelId)
    } else {
      store.startGame()
    }
  }
})

// 拦截返回：对局进行中弹窗确认，确认后结束对局并结算
onBackPress(() => {
  if (store.phase === 'playing') {
    uni.showModal({
      title: '结束当前对局',
      content: '确定要结束当前对局并结算吗？',
      confirmText: '结算',
      cancelText: '继续游戏',
      success: (res) => {
        if (res.confirm) {
          store.endGame()
        }
      },
    })
    return true // 阻止默认返回
  }
  return false
})

// 页面销毁：清理对局（未结算时重置，防止再次进入残留旧对局）
onUnload(() => {
  store.abandon()
})

// 结束 -> 跳结算页
watch(
  () => store.phase,
  (p) => {
    if (p === 'finished') {
      uni.redirectTo({ url: '/pages/Result/index' })
    }
  },
)

// GridBoard 事件代理到 store
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

// 已找到词的格子集合（轻微高亮）
const foundCells = computed(() => {
  const set = new Set<string>()
  for (const fw of store.foundWords) {
    for (const c of fw.cells) set.add(`${c.row},${c.col}`)
  }
  return set
})

const grid = computed(() => store.grid)

// 已找到词按稀有度从高到低排序（idiom > rare > normal > common）
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

// 倒计时 mm:ss
const timeText = computed(() => {
  const m = Math.floor(store.timeLeft / 60)
  const s = store.timeLeft % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const isLowTime = computed(() => store.timeLeft <= 30)

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

onUnmounted(() => {
  if (comboInterval) clearInterval(comboInterval)
})

// 飘字与反馈：成功飘字（稀有度颜色）+ 失败震动 + 音效
const floatVisible = ref(false)
const failFlash = ref(false)
let floatTimer: ReturnType<typeof setTimeout> | null = null
let failTimer: ReturnType<typeof setTimeout> | null = null

const floatColorClass = computed(() => {
  if (store.lastFoundRarity === 'idiom') return 'float-idiom'
  if (store.lastFoundRarity === 'rare') return 'float-rare'
  if (store.lastFoundRarity === 'normal') return 'float-normal'
  return 'float-common'
})

watch(
  () => store.lastFeedback,
  (fb) => {
    if (!fb) return
    if (fb === 'success') {
      floatVisible.value = true
      if (store.lastFoundRarity === 'idiom') playIdiom()
      else playSuccess()
      if (store.combo >= 1) playCombo(store.combo)
      startComboCountdown()
      if (floatTimer) clearTimeout(floatTimer)
      floatTimer = setTimeout(() => {
        floatVisible.value = false
        store.clearFeedback()
      }, 800)
    } else if (fb === 'fail') {
      failFlash.value = true
      playFail()
      uni.vibrateShort({ type: 'light' })
      if (failTimer) clearTimeout(failTimer)
      failTimer = setTimeout(() => {
        failFlash.value = false
        store.clearFeedback()
      }, 350)
    } else if (fb === 'duplicate') {
      if (floatTimer) clearTimeout(floatTimer)
      floatTimer = setTimeout(() => store.clearFeedback(), 600)
    }
  },
)
</script>

<template>
  <view class="game" :class="{ 'game-fail': failFlash }">
    <view class="topbar">
      <text class="timer" :class="{ 'timer-low': isLowTime }">{{ timeText }}</text>
      <text class="score">{{ store.score }}<text class="score-unit">分</text></text>
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

    <view class="float-score" :class="[floatColorClass, { 'float-show': floatVisible }]">
      <template v-if="store.lastFloatScore !== null">
        <text>+{{ store.lastFloatScore }}</text>
        <text v-if="store.comboBonus > 0" class="float-mult">+{{ store.comboBonus }}</text>
      </template>
    </view>
  </view>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 0;
  min-height: 100vh;
  background: #f5f0e8;
  transition: background 0.15s;
}
.game-fail {
  background: #f8d8d8;
}
.topbar {
  width: 620rpx;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.timer {
  font-size: 48rpx;
  font-weight: bold;
  color: #3a2e2e;
  font-variant-numeric: tabular-nums;
}
.timer-low {
  color: #d94a4a;
}
.score {
  font-size: 48rpx;
  font-weight: bold;
  color: #4a90d9;
}
.score-unit {
  font-size: 28rpx;
  color: #8a7a6a;
  margin-left: 8rpx;
}
.combo-bar {
  width: 620rpx;
  height: 52rpx; /* 固定高度占位：连击条显隐不影响网格布局，避免 hitTest 错位 */
  margin-bottom: 8rpx;
  overflow: hidden;
}
.combo-idle {
  visibility: hidden; /* 无连击时内容隐藏但保留高度，网格位置稳定 */
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
  width: 620rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
}
.word-text {
  font-size: 44rpx;
  font-weight: bold;
  color: #3a2e2e;
  letter-spacing: 8rpx;
}
.word-placeholder {
  font-size: 28rpx;
  color: #b0a090;
}
.float-score {
  position: fixed;
  top: 280rpx;
  font-size: 72rpx;
  font-weight: bold;
  color: #4caf50;
  opacity: 0;
  transform: translateY(20rpx);
  transition: opacity 0.2s, transform 0.2s;
  pointer-events: none;
}
.float-common {
  color: #4caf50;
}
.float-normal {
  color: #4a90d9;
}
.float-rare {
  color: #8e44ad;
}
.float-idiom {
  color: #d4a017;
}
.float-mult {
  font-size: 36rpx;
  margin-left: 8rpx;
}
.float-show {
  opacity: 1;
  transform: translateY(0);
}
.found-words {
  width: 620rpx;
  max-height: 150rpx;
  margin-top: 16rpx;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  overflow-y: auto;
}
.found-hint {
  font-size: 22rpx;
  color: #b0a090;
  padding: 8rpx 0;
}
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
</style>
