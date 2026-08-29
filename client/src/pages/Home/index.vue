<script setup lang="ts">
import { clearToken } from '../../api'
import { disconnectSocket } from '../../api/socket'

/** 大厅首页（GDD §6.1 P0）：入口聚合，对齐迭代6详细设计 §8.1 */
function onChapters() {
  uni.navigateTo({ url: '/pages/Chapters/index' })
}
function onBattle() {
  uni.navigateTo({ url: '/pages/Battle/index' })
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
  <view class="home">
    <view class="title">字海寻词</view>
    <view class="subtitle">连线组词 · 实时竞技</view>

    <view class="menu">
      <view class="menu-item" @tap="onChapters">
        <text class="menu-icon">章</text>
        <text class="menu-label">单人闯关</text>
        <text class="menu-desc">章节地图 · 星级挑战</text>
      </view>
      <view class="menu-item" @tap="onBattle">
        <text class="menu-icon battle">战</text>
        <text class="menu-label">实时对战</text>
        <text class="menu-desc">同网格 1v1 · 实时比拼</text>
      </view>
      <view class="menu-item" @tap="onPokedex">
        <text class="menu-icon pokedex">鉴</text>
        <text class="menu-label">词库图鉴</text>
        <text class="menu-desc">收集你找到的词</text>
      </view>
    </view>

    <view class="logout" @tap="onLogout">退出登录</view>
  </view>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  background: #f5f0e8;
  padding: 120rpx 40rpx 60rpx;
  box-sizing: border-box;
}
.title {
  font-size: 72rpx;
  font-weight: bold;
  color: #3a2e2e;
  letter-spacing: 12rpx;
}
.subtitle {
  font-size: 28rpx;
  color: #8a7a6a;
  margin-top: 16rpx;
}
.menu {
  width: 100%;
  margin-top: 100rpx;
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}
.menu-item {
  background: #ffffff;
  border-radius: 16rpx;
  border: 2rpx solid #d4c8b8;
  padding: 32rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24rpx;
}
.menu-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 16rpx;
  background: #4a90d9;
  color: #fff;
  font-size: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.menu-icon.battle { background: #d94a4a; }
.menu-icon.pokedex { background: #d4a017; }
.menu-label {
  font-size: 34rpx;
  font-weight: bold;
  color: #3a2e2e;
}
.menu-desc {
  font-size: 24rpx;
  color: #8a7a6a;
}
.logout {
  margin-top: auto;
  font-size: 28rpx;
  color: #b0a090;
  padding: 24rpx 0 0;
}
</style>
