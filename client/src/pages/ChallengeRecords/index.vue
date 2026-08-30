<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchMyChallenges } from '../../api'

const list = ref<Array<{ challengeId: string; createdAt: string; challengerScore: number; attemptCount: number; bestScore: number; bestNickname: string | null; beaten: boolean }>>([])
const loading = ref(false)

onShow(async () => {
  loading.value = true
  try {
    const res = await fetchMyChallenges()
    list.value = res.challenges
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
})

function onDetail(id: string) {
  uni.navigateTo({ url: `/pages/ChallengeEntry/index?challenge=${id}` })
}

function onCopyLink(id: string) {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const link = origin ? `${origin}/#/pages/ChallengeEntry/index?challenge=${id}` : `challenge=${id}`
  uni.setClipboardData({
    data: link,
    success: () => uni.showToast({ title: '链接已复制', icon: 'success' }),
  })
}

function onHome() {
  uni.reLaunch({ url: '/pages/Home/index' })
}
</script>

<template>
  <view class="records">
    <view v-if="loading" class="loading"><text>加载中...</text></view>
    <view v-else-if="list.length === 0" class="empty">
      <text>还没有发起过挑战</text>
      <text class="hint">完成一局后在结算页发起挑战吧</text>
      <button class="btn-ghost" @tap="onHome">返回大厅</button>
    </view>
    <view v-else class="list">
      <view v-for="item in list" :key="item.challengeId" class="card">
        <text class="score">你的得分 {{ item.challengerScore }}</text>
        <text class="meta">{{ item.createdAt.slice(0,10) }} · 被挑战 {{ item.attemptCount }} 次</text>
        <text v-if="item.bestNickname" class="best">最高分 {{ item.bestNickname }} {{ item.bestScore }} <text v-if="item.beaten" class="beaten">已被超越</text><text v-else class="holding">守住</text></text>
        <text v-else class="best">暂无人挑战</text>
        <view class="actions">
          <button class="btn-small" @tap="onDetail(item.challengeId)">查看</button>
          <button class="btn-small primary" @tap="onCopyLink(item.challengeId)">复制链接</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.records { display: flex; flex-direction: column; padding: 40rpx; min-height: 100vh; background: #f5f0e8; }
.loading, .empty { display: flex; flex-direction: column; align-items: center; color: #8a7a6a; gap: 12rpx; padding: 80rpx 0; }
.hint { font-size: 24rpx; color: #b0a090; }
.list { display: flex; flex-direction: column; gap: 16rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; display: flex; flex-direction: column; gap: 8rpx; border: 1rpx solid #d4c8b8; }
.score { font-size: 32rpx; font-weight: bold; color: #3a2e2e; }
.meta { font-size: 24rpx; color: #8a7a6a; }
.best { font-size: 26rpx; color: #6a5a4a; }
.beaten { color: #d94a4a; font-weight: bold; }
.holding { color: #4caf50; font-weight: bold; }
.actions { display: flex; flex-direction: row; gap: 16rpx; margin-top: 8rpx; }
.btn-small { flex: 1; font-size: 26rpx; border-radius: 24rpx; background: #fff; border: 1rpx solid #d4c8b8; color: #3a2e2e; }
.btn-small.primary { background: #4a90d9; color: #fff; border-color: #4a90d9; }
.btn-small::after { border: none; }
.btn-ghost { background: transparent; color: #4a90d9; margin-top: 16rpx; }
.btn-ghost::after { border: none; }
</style>
