<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchRankMe, fetchEconomy } from '../../api'

const rank = ref<{ rankTier: number; rankScore: number; wins: number; losses: number; winRate: number; season: string } | null>(null)
const economy = ref<{ coins: number; diamonds: number; stamina: number; maxStamina: number } | null>(null)
const loading = ref(true)

const tierNames: Record<number, string> = { 1: '字童', 2: '字生', 3: '字秀', 4: '字举', 5: '字士', 6: '字翰', 7: '字圣' }

async function load() {
  loading.value = true
  try {
    const [r, e] = await Promise.all([fetchRankMe(), fetchEconomy()])
    rank.value = r
    economy.value = e
  } catch {}
  loading.value = false
}
onShow(load)
</script>

<template>
  <view class="rank">
    <view v-if="loading" class="loading">加载中...</view>
    <view v-else-if="rank" class="card">
      <text class="tier">{{ tierNames[rank.rankTier] ?? `段位${rank.rankTier}` }}</text>
      <text class="score">积分 {{ rank.rankScore }}</text>
      <text class="season">赛季 {{ rank.season }}</text>
      <view class="stats">
        <text class="stat">胜 {{ rank.wins }}</text>
        <text class="stat">负 {{ rank.losses }}</text>
        <text class="stat">胜率 {{ (rank.winRate * 100).toFixed(0) }}%</text>
      </view>
      <view v-if="economy" class="eco">
        <text>🪙 {{ economy.coins }}  💎 {{ economy.diamonds }}  ⚡ {{ economy.stamina }}/{{ economy.maxStamina }}</text>
      </view>
      <text class="desc">自然月赛季重置保留60%积分，胜+20±段位差，负-10±段位差</text>
    </view>
  </view>
</template>

<style scoped>
.rank { min-height: 100vh; background: #f5f0e8; padding: 40rpx; display: flex; flex-direction: column; align-items: center; }
.loading { font-size: 28rpx; color: #8a7a6a; margin-top: 100rpx; }
.card { background: #fff; border: 2rpx solid #d4c8b8; border-radius: 16rpx; padding: 40rpx; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 16rpx; }
.tier { font-size: 48rpx; font-weight: bold; color: #2980b9; }
.score { font-size: 36rpx; color: #3a2e2e; }
.season { font-size: 24rpx; color: #8a7a6a; }
.stats { display: flex; flex-direction: row; gap: 24rpx; margin-top: 16rpx; }
.stat { font-size: 26rpx; color: #3a2e2e; }
.eco { font-size: 24rpx; color: #8a7a6a; margin-top: 12rpx; }
.desc { font-size: 22rpx; color: #b0a090; margin-top: 20rpx; text-align: center; }
</style>
