<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchDailyInfo, startDailyRequest } from '../../api'
import { useGameStore } from '../../store/game'

const store = useGameStore()
const info = ref<{ date: string; size: number; duration: number; attemptsUsed: number; attemptsLeft: number; myBest: number | null } | null>(null)
const loading = ref(false)
const errorMsg = ref('')

async function load() {
  try {
    info.value = await fetchDailyInfo()
  } catch (e) {
    errorMsg.value = (e as Error).message
  }
}

onShow(() => {
  load()
})

async function onStart() {
  if (!info.value) return
  if (info.value.attemptsLeft <= 0) {
    uni.showToast({ title: '今日次数已用完', icon: 'none' })
    return
  }
  loading.value = true
  try {
    const res = await startDailyRequest()
    store.startDaily(res)
    uni.redirectTo({ url: '/pages/Game/index?daily=1' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function onLeaderboard() {
  uni.navigateTo({ url: '/pages/Leaderboard/index?type=daily' })
}
function onHome() {
  uni.reLaunch({ url: '/pages/Home/index' })
}
</script>

<template>
  <view class="daily">
    <view class="card">
      <text class="title">每日挑战</text>
      <text v-if="info" class="date">{{ info.date }} · {{ info.size }}×{{ info.size }} · {{ info.duration }}秒</text>
      <view v-if="info" class="stats">
        <text class="stat">今日已用 {{ info.attemptsUsed }}/3 次</text>
        <text class="stat">剩余 {{ info.attemptsLeft }} 次</text>
        <text v-if="info.myBest !== null" class="stat">今日最高 {{ info.myBest }} 分</text>
        <text v-else class="stat">今日未挑战</text>
      </view>
      <text v-if="errorMsg" class="error">{{ errorMsg }}</text>
      <button class="btn-primary" :disabled="loading || !info || info.attemptsLeft <= 0" @tap="onStart">
        {{ loading ? '加载中...' : (info && info.attemptsLeft <= 0 ? '今日已完成' : '开始今日挑战') }}
      </button>
      <text class="hint">3 次机会，取最高分 · 全球同一网格</text>
      <view class="actions">
        <button class="btn-secondary" @tap="onLeaderboard">查看排行榜</button>
        <button class="btn-ghost" @tap="onHome">返回大厅</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.daily { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; min-height: 100vh; background: #f5f0e8; }
.card { width: 100%; background: #fff; border-radius: 16rpx; padding: 40rpx; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 16rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #3a2e2e; }
.date { font-size: 26rpx; color: #8a7a6a; }
.stats { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.stat { font-size: 26rpx; color: #6a5a4a; }
.error { font-size: 24rpx; color: #d94a4a; }
.btn-primary { width: 100%; background: #4caf50; color: #fff; border-radius: 44rpx; margin-top: 16rpx; }
.btn-primary::after { border: none; }
.btn-secondary { width: 100%; background: #fff; color: #4a90d9; border: 2rpx solid #4a90d9; border-radius: 44rpx; margin-top: 12rpx; }
.btn-secondary::after { border: none; }
.btn-ghost { width: 100%; background: transparent; color: #8a7a6a; font-size: 26rpx; margin-top: 8rpx; }
.btn-ghost::after { border: none; }
.hint { font-size: 22rpx; color: #b0a090; margin-top: 8rpx; }
.actions { width: 100%; display: flex; flex-direction: column; gap: 8rpx; margin-top: 8rpx; }
</style>
