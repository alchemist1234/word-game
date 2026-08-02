<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useGameStore } from '../../store/game'
import GridBoard from '../../components/GridBoard.vue'
import type { CellPos } from '../../core/types'

const store = useGameStore()

// 进入页面确保对局进行中
onShow(() => {
  if (store.phase !== 'playing') {
    store.startGame()
  }
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

// 倒计时 mm:ss
const timeText = computed(() => {
  const m = Math.floor(store.timeLeft / 60)
  const s = store.timeLeft % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const isLowTime = computed(() => store.timeLeft <= 30)

// 飘字与反馈：成功飘字 + 失败震动
const floatVisible = ref(false)
const failFlash = ref(false)
let floatTimer: ReturnType<typeof setTimeout> | null = null
let failTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => store.lastFeedback,
  (fb) => {
    if (!fb) return
    if (fb === 'success') {
      floatVisible.value = true
      if (floatTimer) clearTimeout(floatTimer)
      floatTimer = setTimeout(() => {
        floatVisible.value = false
        store.clearFeedback()
      }, 800)
    } else if (fb === 'fail') {
      failFlash.value = true
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

    <view class="float-score" :class="{ 'float-show': floatVisible }">
      <text v-if="store.lastFloatScore !== null">+{{ store.lastFloatScore }}</text>
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
.float-show {
  opacity: 1;
  transform: translateY(0);
}
</style>
