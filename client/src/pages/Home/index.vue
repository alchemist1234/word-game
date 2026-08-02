<script setup lang="ts">
import { useGameStore } from '../../store/game'

const store = useGameStore()

function startGame() {
  store.startGame()
  uni.navigateTo({ url: '/pages/Game/index' })
}
</script>

<template>
  <view class="home">
    <view class="title-wrap">
      <text class="title">字海寻词</text>
      <text class="subtitle">汉字网格 · 连线组词</text>
    </view>
    <view class="rules">
      <text class="rule">在 5×5 网格中连接相邻汉字</text>
      <text class="rule">组成词语得分，成语高分</text>
      <text class="rule">3 分钟内尽可能多找词</text>
    </view>
    <button class="start-btn" @tap="startGame">开始游戏</button>
  </view>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f0e8 0%, #ede4d3 100%);
}
.title-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 80rpx;
}
.title {
  font-size: 80rpx;
  font-weight: bold;
  color: #3a2e2e;
  letter-spacing: 8rpx;
}
.subtitle {
  font-size: 28rpx;
  color: #8a7a6a;
  margin-top: 16rpx;
}
.rules {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 100rpx;
}
.rule {
  font-size: 26rpx;
  color: #6a5a4a;
  line-height: 48rpx;
}
.start-btn {
  width: 400rpx;
  height: 96rpx;
  line-height: 96rpx;
  background: #4a90d9;
  color: #ffffff;
  font-size: 36rpx;
  border-radius: 48rpx;
  border: none;
}
.start-btn::after {
  border: none;
}
</style>
