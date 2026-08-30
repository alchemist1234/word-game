<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchChallengeDetail, startChallengeRequest, getToken } from '../../api'
import { useGameStore } from '../../store/game'

const store = useGameStore()
const challengeId = ref('')
const detail = ref<{
  id: string
  gridSeed: string
  duration: number
  challenger: { userId: number; nickname: string; score: number }
  stats: { attemptCount: number; bestScore: number; bestNickname: string | null }
  myBest: number | null
  beatChallenger: boolean
} | null>(null)
const errorMsg = ref('')
const loading = ref(false)

onLoad((opts?: { challenge?: string }) => {
  const id = opts?.challenge
  if (!id) {
    errorMsg.value = '缺少挑战ID'
    return
  }
  challengeId.value = id
  // Check token: if not logged in, save pending and go to login
  if (!getToken()) {
    uni.setStorageSync('pendingChallenge', id)
    uni.reLaunch({ url: '/pages/Login/index' })
    return
  }
  load()
})

async function load() {
  try {
    detail.value = await fetchChallengeDetail(challengeId.value)
  } catch (e) {
    errorMsg.value = (e as Error).message
  }
}

async function onStart() {
  if (!challengeId.value) return
  loading.value = true
  try {
    const res = await startChallengeRequest(challengeId.value)
    store.startChallenge({
      matchSessionId: res.matchSessionId,
      grid: res.grid,
      duration: res.duration,
      challengeId: challengeId.value,
      challenger: res.challenger,
    })
    uni.redirectTo({ url: `/pages/Game/index?challengeId=${challengeId.value}` })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function onHome() {
  uni.reLaunch({ url: '/pages/Home/index' })
}
</script>

<template>
  <view class="entry">
    <view v-if="errorMsg" class="error-card">
      <text class="error">{{ errorMsg }}</text>
      <button class="btn-ghost" @tap="onHome">返回大厅</button>
    </view>
    <view v-else-if="detail" class="card">
      <text class="title">好友挑战</text>
      <text class="challenger">{{ detail.challenger.nickname }} 得分 {{ detail.challenger.score }}</text>
      <text class="desc">邀请你挑战同一网格，打败 TA！</text>
      <view class="stats">
        <text class="stat">已挑战 {{ detail.stats.attemptCount }} 人次</text>
        <text v-if="detail.stats.bestNickname" class="stat">最高分 {{ detail.stats.bestNickname }} {{ detail.stats.bestScore }}</text>
      </view>
      <view v-if="detail.myBest !== null" class="my-best">
        <text>我的最好成绩 {{ detail.myBest }}</text>
        <text v-if="detail.beatChallenger" class="beat">已超越！</text>
        <text v-else class="not-beat">再接再厉</text>
      </view>
      <button class="btn-primary" :disabled="loading" @tap="onStart">{{ loading ? '加载中...' : '开始挑战' }}</button>
      <button class="btn-ghost" @tap="onHome">返回大厅</button>
    </view>
    <view v-else class="loading">
      <text>加载中...</text>
    </view>
  </view>
</template>

<style scoped>
.entry { display: flex; flex-direction: column; align-items: center; padding: 80rpx 40rpx; min-height: 100vh; background: #f5f0e8; }
.card { width: 100%; background: #fff; border-radius: 16rpx; padding: 40rpx; display: flex; flex-direction: column; align-items: center; gap: 16rpx; }
.title { font-size: 48rpx; font-weight: bold; color: #3a2e2e; }
.challenger { font-size: 36rpx; font-weight: bold; color: #d94a4a; }
.desc { font-size: 26rpx; color: #8a7a6a; }
.stats { display: flex; flex-direction: column; align-items: center; gap: 6rpx; }
.stat { font-size: 24rpx; color: #6a5a4a; }
.my-best { margin-top: 12rpx; display: flex; flex-direction: column; align-items: center; gap: 4rpx; font-size: 26rpx; color: #4a90d9; }
.beat { color: #4caf50; font-weight: bold; }
.not-beat { color: #8a7a6a; }
.btn-primary { width: 100%; background: #ff7043; color: #fff; border-radius: 44rpx; margin-top: 16rpx; }
.btn-primary::after { border: none; }
.btn-ghost { width: 100%; background: transparent; color: #8a7a6a; margin-top: 12rpx; }
.btn-ghost::after { border: none; }
.error { color: #d94a4a; }
.error-card { width: 100%; background: #fff; border-radius: 16rpx; padding: 40rpx; display: flex; flex-direction: column; align-items: center; gap: 16rpx; }
.loading { color: #8a7a6a; }
</style>
