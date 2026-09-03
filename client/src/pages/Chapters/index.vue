<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchChapters, clearToken, type ChaptersResponse } from '../../api'
import { disconnectSocket } from '../../api/socket'

const data = ref<ChaptersResponse | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    data.value = await fetchChapters()
  } catch (e) {
    console.error('fetchChapters', e)
  } finally {
    loading.value = false
  }
}

onShow(load)

function onLevel(levelId: string, unlocked: boolean) {
  if (!unlocked) return
  uni.navigateTo({ url: `/pages/Game/index?levelId=${levelId}` })
}

function onPokedex() {
  uni.navigateTo({ url: '/pages/Pokedex/index' })
}

function onLogout() {
  disconnectSocket()
  clearToken()
  uni.reLaunch({ url: '/pages/Login/index' })
}
</script>

<template>
  <view class="chapters">
    <view class="header">
      <text class="header-title">章节地图</text>
      <view class="header-actions">
        <text class="action" @tap="onPokedex">图鉴</text>
        <text class="action" @tap="onLogout">退出</text>
      </view>
    </view>

    <view v-if="loading" class="loading">加载中...</view>

    <scroll-view v-else scroll-y class="chapter-list">
      <view
        v-for="ch in data?.chapters"
        :key="ch.chapter"
        class="chapter"
        :class="{ locked: !ch.unlocked }"
      >
        <text class="chapter-title">第{{ ch.chapter }}章 {{ ch.title }}</text>
        <view class="level-grid">
          <view
            v-for="lv in ch.levels"
            :key="lv.id"
            class="level-node"
            :class="{ unlocked: lv.unlocked, locked: !lv.unlocked, boss: lv.boss }"
            @tap="onLevel(lv.id, lv.unlocked)"
          >
            <text class="level-num">{{ lv.id }}</text>
            <text class="level-title">{{ lv.title }}</text>
            <text v-if="lv.boss" class="boss-tag">Boss</text>
            <text v-else class="boss-tag boss-tag-placeholder">Boss</text>
            <text class="level-stars">
              {{ lv.stars >= 1 ? '★' : '☆' }}{{ lv.stars >= 2 ? '★' : '☆' }}{{ lv.stars >= 3 ? '★' : '☆' }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.chapters {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f5f0e8;
}
.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 32rpx;
}
.header-title { font-size: 36rpx; font-weight: bold; color: #3a2e2e; }
.header-actions { display: flex; flex-direction: row; gap: 24rpx; }
.action { font-size: 28rpx; color: #4a90d9; }
.loading { text-align: center; padding: 80rpx; color: #b0a090; }
.chapter-list { flex: 1; padding: 0 32rpx 40rpx; box-sizing: border-box; width: 100%; }
.chapter { margin-bottom: 32rpx; width: 100%; box-sizing: border-box; }
.chapter.locked { opacity: 0.5; }
.chapter-title { font-size: 32rpx; font-weight: bold; color: #3a2e2e; margin-bottom: 16rpx; display: block; }
.level-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16rpx; width: 100%; box-sizing: border-box; }
.level-node {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 20rpx 16rpx;
  background: #ffffff;
  border-radius: 12rpx;
  border: 2rpx solid #d4c8b8;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.level-node.unlocked { border-color: #4a90d9; }
.level-node.boss { border-color: #d94a4a; }
.level-node.locked { opacity: 0.4; background: #e8e0d0; }
.level-num { font-size: 22rpx; color: #8a7a6a; }
.level-title { font-size: 26rpx; color: #3a2e2e; margin: 4rpx 0; min-height: 36rpx; display: flex; align-items: center; text-align: center; }
.boss-tag { font-size: 20rpx; color: #fff; background: #d94a4a; border-radius: 8rpx; padding: 2rpx 10rpx; margin-top: 4rpx; }
.boss-tag-placeholder { visibility: hidden; }
.level-stars { font-size: 24rpx; color: #d4a017; }
</style>
