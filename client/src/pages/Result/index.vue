<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/game'

const store = useGameStore()

// 找到的词按分值降序
const sortedWords = computed(() =>
  [...store.foundWords].sort((a, b) => b.score - a.score),
)

// 成语数
const idiomCount = computed(
  () => store.foundWords.filter((w) => w.rarity === 'idiom').length,
)

function playAgain() {
  store.startGame()
  uni.redirectTo({ url: '/pages/Game/index' })
}

function goHome() {
  store.restart()
  uni.reLaunch({ url: '/pages/Home/index' })
}
</script>

<template>
  <view class="result">
    <text class="title">本局结束</text>
    <view class="score-wrap">
      <text class="total-score">{{ store.score }}</text>
      <text class="score-unit">分</text>
    </view>
    <view class="stats">
      <text class="stat">找到 {{ store.foundWords.length }} 个词</text>
      <text class="stat">含 {{ idiomCount }} 个成语</text>
    </view>

    <scroll-view class="word-list" scroll-y>
      <view
        v-for="fw in sortedWords"
        :key="fw.word"
        class="word-item"
        :class="'rarity-' + fw.rarity"
      >
        <text class="word-text">{{ fw.word }}</text>
        <text class="word-rarity">{{ fw.rarity }}</text>
        <text class="word-score">+{{ fw.score }}</text>
      </view>
      <view v-if="sortedWords.length === 0" class="empty">
        <text>没有找到词，再接再厉</text>
      </view>
    </scroll-view>

    <view class="actions">
      <button class="btn-primary" @tap="playAgain">再来一局</button>
      <button class="btn-secondary" @tap="goHome">返回首页</button>
    </view>
  </view>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 40rpx;
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f0e8 0%, #ede4d3 100%);
}
.title {
  font-size: 40rpx;
  color: #8a7a6a;
}
.score-wrap {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  margin: 24rpx 0;
}
.total-score {
  font-size: 120rpx;
  font-weight: bold;
  color: #4a90d9;
}
.score-unit {
  font-size: 40rpx;
  color: #8a7a6a;
  margin-left: 12rpx;
}
.stats {
  display: flex;
  flex-direction: row;
  gap: 40rpx;
  margin-bottom: 32rpx;
}
.stat {
  font-size: 28rpx;
  color: #6a5a4a;
}
.word-list {
  width: 100%;
  flex: 1;
  max-height: 600rpx;
}
.word-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 20rpx 32rpx;
  margin-bottom: 12rpx;
  background: #ffffff;
  border-radius: 12rpx;
  border-left: 8rpx solid #d4c8b8;
}
.word-item.rarity-idiom {
  border-left-color: #d4a017;
  background: #fffbeb;
}
.word-item.rarity-rare {
  border-left-color: #8e44ad;
}
.word-item.rarity-normal {
  border-left-color: #4a90d9;
}
.word-text {
  font-size: 36rpx;
  font-weight: bold;
  color: #3a2e2e;
  letter-spacing: 4rpx;
}
.rarity-idiom .word-text {
  color: #b8860b;
}
.word-rarity {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: #b0a090;
}
.word-score {
  font-size: 32rpx;
  font-weight: bold;
  color: #4caf50;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80rpx 0;
  color: #b0a090;
}
.actions {
  display: flex;
  flex-direction: row;
  gap: 24rpx;
  width: 100%;
  margin-top: 32rpx;
}
.btn-primary {
  flex: 1;
  background: #4a90d9;
  color: #ffffff;
  font-size: 32rpx;
  border-radius: 48rpx;
  border: none;
}
.btn-secondary {
  flex: 1;
  background: #ffffff;
  color: #4a90d9;
  font-size: 32rpx;
  border-radius: 48rpx;
  border: 2rpx solid #4a90d9;
}
.btn-primary::after,
.btn-secondary::after {
  border: none;
}
</style>
