<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchPokedex, type PokedexResponse } from '../../api'

const data = ref<PokedexResponse | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    data.value = await fetchPokedex()
  } catch (e) {
    console.error('fetchPokedex', e)
  } finally {
    loading.value = false
  }
}

onShow(load)
</script>

<template>
  <view class="pokedex">
    <view class="stats">
      <text class="count">已收集 {{ data?.collected ?? 0 }} / {{ data?.total ?? 0 }}</text>
    </view>
    <scroll-view v-if="!loading" scroll-y class="word-list">
      <view
        v-for="w in data?.words"
        :key="w.word"
        class="word-item"
        :class="'rarity-' + w.rarity"
      >
        <text class="word">{{ w.word }}</text>
        <text class="rarity-label">{{ w.rarity }}</text>
        <text class="count-label">×{{ w.foundCount }}</text>
      </view>
      <view v-if="data?.words.length === 0" class="empty">
        <text>还没有收集到任何词，去闯关吧！</text>
      </view>
    </scroll-view>
    <view v-else class="loading">加载中...</view>
  </view>
</template>

<style scoped>
.pokedex { display: flex; flex-direction: column; min-height: 100vh; background: #f5f0e8; }
.stats { padding: 24rpx 32rpx; }
.count { font-size: 30rpx; color: #3a2e2e; font-weight: bold; }
.word-list { flex: 1; padding: 0 32rpx 40rpx; }
.word-item {
  display: flex; flex-direction: row; align-items: center;
  padding: 16rpx 24rpx; margin-bottom: 12rpx;
  background: #ffffff; border-radius: 10rpx;
  border-left: 8rpx solid #d4c8b8;
}
.word-item.rarity-idiom { border-left-color: #d4a017; background: #fffbeb; }
.word-item.rarity-rare { border-left-color: #8e44ad; }
.word-item.rarity-normal { border-left-color: #4a90d9; }
.word { font-size: 32rpx; font-weight: bold; color: #3a2e2e; }
.rarity-idiom .word { color: #b8860b; }
.rarity-label { flex: 1; text-align: center; font-size: 22rpx; color: #b0a090; }
.count-label { font-size: 24rpx; color: #8a7a6a; }
.empty { text-align: center; padding: 80rpx; color: #b0a090; }
.loading { text-align: center; padding: 80rpx; color: #b0a090; }
</style>
