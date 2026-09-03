<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchMyWordApplies, type MyWordApply } from '../../api'

const list = ref<MyWordApply[]>([])
const loading = ref(true)

function statusText(item: MyWordApply): string {
  if (item.status === 'auto_merged' || item.status === 'approved') return '已加入词库'
  if (item.status === 'rejected') return '未通过'
  return '审核中'
}

function formatTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  // 固定东八区（与服务端每日边界 Asia/Shanghai 一致，不依赖设备时区）
  const d = new Date(t + 8 * 3600 * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

async function load() {
  loading.value = true
  try {
    const res = await fetchMyWordApplies()
    list.value = res.list
  } catch (e) {
    console.error('fetchMyWordApplies', e)
  } finally {
    loading.value = false
  }
}

onShow(load)
</script>

<template>
  <view class="word-apply">
    <scroll-view v-if="!loading" scroll-y class="apply-list">
      <view
        v-for="item in list"
        :key="item.word"
        class="apply-item"
        :class="'status-' + item.status"
      >
        <text class="word">{{ item.word }}</text>
        <text class="status">{{ statusText(item) }}</text>
        <text class="time">{{ formatTime(item.createdAt) }}</text>
      </view>
      <view v-if="list.length === 0" class="empty">
        <text>还没有申请过，对局里遇到未收录的词可以申请哦</text>
      </view>
    </scroll-view>
    <view v-else class="loading">加载中...</view>
  </view>
</template>

<style scoped>
.word-apply { display: flex; flex-direction: column; min-height: 100vh; background: #f5f0e8; width: 100%; box-sizing: border-box; overflow-x: hidden; }
.apply-list { flex: 1; padding: 32rpx 32rpx 40rpx; box-sizing: border-box; width: 100%; }
.apply-item {
  display: flex; flex-direction: row; align-items: center;
  padding: 20rpx 24rpx; margin-bottom: 12rpx;
  background: #ffffff; border-radius: 10rpx;
  border-left: 8rpx solid #d4a017;
  box-sizing: border-box; width: 100%;
}
.apply-item.status-auto_merged, .apply-item.status-approved { border-left-color: #4caf50; }
.apply-item.status-rejected { border-left-color: #d94a4a; }
.word { flex: none; font-size: 32rpx; font-weight: bold; color: #3a2e2e; letter-spacing: 4rpx; }
.status { flex: 1; min-width: 0; text-align: center; font-size: 24rpx; color: #b8860b; }
.status-auto_merged .status, .status-approved .status { color: #4caf50; }
.status-rejected .status { color: #d94a4a; }
.time { flex: none; font-size: 20rpx; color: #b0a090; }
.empty { text-align: center; padding: 80rpx 32rpx; color: #b0a090; }
.loading { text-align: center; padding: 80rpx; color: #b0a090; }
</style>
