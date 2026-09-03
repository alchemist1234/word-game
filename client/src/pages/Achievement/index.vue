<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchAchievements, claimAchievement, type AchievementItem } from '../../api'

const list = ref<AchievementItem[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const res = await fetchAchievements()
    list.value = res.list
  } finally { loading.value = false }
}

async function onClaim(id: string) {
  await claimAchievement(id)
  await load()
}

onShow(load)
</script>

<template>
  <view class="achievements">
    <view v-if="loading" class="loading">加载中...</view>
    <view v-else>
      <view v-for="a in list" :key="a.id" class="ach" :class="{ unlocked: a.unlocked }">
        <text class="name">{{ a.name }}</text>
        <text class="desc">{{ a.desc }}</text>
        <text v-if="a.unlocked" class="status">已解锁 {{ a.claimed ? '已领取' : '' }}</text>
        <text v-else class="status">未解锁</text>
        <view v-if="a.unlocked && !a.claimed" class="claim" @tap="onClaim(a.id)">领取</view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.achievements { padding: 32rpx; background: #f5f0e8; min-height: 100vh; }
.ach { background: #fff; border-radius: 12rpx; padding: 24rpx; margin-bottom: 16rpx; opacity: 0.6; }
.ach.unlocked { opacity: 1; border-left: 8rpx solid #d4a017; }
.name { font-size: 28rpx; font-weight: bold; color: #3a2e2e; }
.desc { display: block; margin-top: 8rpx; font-size: 24rpx; color: #6b6b6b; }
.status { display: block; margin-top: 8rpx; font-size: 22rpx; color: #8a7a6a; }
.claim { margin-top: 12rpx; text-align: center; background: #d4a017; color: #fff; padding: 12rpx; border-radius: 8rpx; }
.loading { text-align: center; padding: 80rpx; color: #b0a090; }
</style>
