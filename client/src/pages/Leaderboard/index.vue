<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { fetchLeaderboard } from '../../api'

const active = ref<'daily' | 'season' | 'all'>('daily')
const data = ref<{ type: string; period: string; mine: { userId: number; nickname: string; score: number; rank: number } | null; list: Array<{ userId: number; nickname: string; score: number }> } | null>(null)
const loading = ref(false)

onLoad((opts?: { type?: string }) => {
  if (opts?.type && ['daily','season','all'].includes(opts.type)) {
    active.value = opts.type as 'daily'|'season'|'all'
  }
})
onShow(() => {
  load()
})

async function load() {
  loading.value = true
  try {
    data.value = await fetchLeaderboard(active.value)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function switchTab(t: 'daily' | 'season' | 'all') {
  active.value = t
  load()
}

const tabLabels: Record<string, string> = { daily: '每日榜', season: '赛季榜', all: '总榜' }
</script>

<template>
  <view class="lb">
    <view class="tabs">
      <view class="tab" :class="{ active: active === 'daily' }" @tap="switchTab('daily')">每日榜</view>
      <view class="tab" :class="{ active: active === 'season' }" @tap="switchTab('season')">赛季榜</view>
      <view class="tab" :class="{ active: active === 'all' }" @tap="switchTab('all')">总榜</view>
    </view>
    <text v-if="data" class="period">{{ tabLabels[data.type] }} · {{ data.period }}</text>
    <view v-if="loading" class="loading"><text>加载中...</text></view>
    <view v-else-if="data" class="list">
      <view v-for="(item, idx) in data.list" :key="item.userId" class="row" :class="{ mine: data.mine && data.mine.userId === item.userId }">
        <text class="rank">{{ idx + 1 }}</text>
        <text class="nick">{{ item.nickname }}</text>
        <text class="score">{{ item.score }}</text>
      </view>
      <view v-if="data.list.length === 0" class="empty"><text>暂无上榜</text></view>
      <view v-if="data.mine && !data.list.some(x => x.userId === data.mine!.userId)" class="mine-row">
        <text class="mine-label">我的排名</text>
        <text class="rank">{{ data.mine.rank }}</text>
        <text class="nick">{{ data.mine.nickname }}</text>
        <text class="score">{{ data.mine.score }}</text>
      </view>
      <view v-else-if="data.mine" class="mine-info">
        <text>我的排名：{{ data.mine.rank }} · 得分 {{ data.mine.score }}</text>
      </view>
      <view v-else class="mine-info"><text>暂无排名，去挑战吧</text></view>
    </view>
  </view>
</template>

<style scoped>
.lb { display: flex; flex-direction: column; align-items: center; padding: 40rpx; min-height: 100vh; background: #f5f0e8; }
.tabs { display: flex; flex-direction: row; gap: 16rpx; margin-bottom: 24rpx; }
.tab { padding: 16rpx 32rpx; background: #fff; border-radius: 32rpx; font-size: 28rpx; color: #8a7a6a; border: 2rpx solid #d4c8b8; }
.tab.active { background: #4a90d9; color: #fff; border-color: #4a90d9; }
.period { font-size: 24rpx; color: #b0a090; margin-bottom: 16rpx; }
.list { width: 100%; background: #fff; border-radius: 16rpx; padding: 16rpx; }
.row { display: flex; flex-direction: row; align-items: center; padding: 16rpx; border-bottom: 1rpx solid #f0ece4; }
.row.mine { background: #e3f2fd; border-radius: 8rpx; }
.rank { width: 80rpx; font-weight: bold; color: #d4a017; }
.nick { flex: 1; color: #3a2e2e; }
.score { font-weight: bold; color: #4a90d9; }
.empty { padding: 40rpx; text-align: center; color: #b0a090; }
.mine-row { display: flex; flex-direction: row; align-items: center; gap: 12rpx; padding: 16rpx; margin-top: 16rpx; border-top: 2rpx dashed #d4c8b8; background: #fff8e1; border-radius: 8rpx; }
.mine-label { font-size: 24rpx; color: #8a7a6a; }
.mine-info { margin-top: 24rpx; font-size: 26rpx; color: #4a90d9; text-align: center; }
.loading { color: #8a7a6a; }
</style>
