<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { clearToken, fetchEconomy, fetchRankMe } from '../../api'
import { disconnectSocket } from '../../api/socket'

/** 大厅首页（GDD §6.1 P0 + 迭代7：每日/排行榜入口 + 迭代8a：段位/4人/经济） */
const economy = ref<{ coins: number; diamonds: number; stamina: number; maxStamina: number; rankTier: number } | null>(null)
const rank = ref<{ rankTier: number; rankScore: number } | null>(null)

function loadEconomy() {
  fetchEconomy().then((r) => { economy.value = r }).catch(() => {})
  fetchRankMe().then((r) => { rank.value = r }).catch(() => {})
}
onShow(loadEconomy)

function onChapters() {
  uni.navigateTo({ url: '/pages/Chapters/index' })
}
function onBattle() {
  uni.navigateTo({ url: '/pages/Battle/index' })
}
function onBattle4p() {
  uni.navigateTo({ url: '/pages/Battle4p/index' })
}
function onRank() {
  uni.navigateTo({ url: '/pages/Rank/index' })
}
function onPokedex() {
  uni.navigateTo({ url: '/pages/Pokedex/index' })
}
function onDaily() {
  uni.navigateTo({ url: '/pages/Daily/index' })
}
function onLeaderboard() {
  uni.navigateTo({ url: '/pages/Leaderboard/index' })
}
function onChallengeRecords() {
  uni.navigateTo({ url: '/pages/ChallengeRecords/index' })
}
function onInventory() {
  uni.navigateTo({ url: '/pages/Inventory/index' })
}
function onAchievement() {
  uni.navigateTo({ url: '/pages/Achievement/index' })
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
    <view v-if="economy" class="economy-bar">
      <text class="eco-item">⚡ {{ economy.stamina }}/{{ economy.maxStamina }}</text>
      <text class="eco-item">🪙 {{ economy.coins }}</text>
      <text class="eco-item">💎 {{ economy.diamonds }}</text>
      <text class="eco-item rank">段位 {{ rank?.rankTier ?? economy.rankTier }}</text>
    </view>

    <view class="menu">
      <view class="menu-item daily-item" @tap="onDaily">
        <text class="menu-icon daily">今</text>
        <text class="menu-label">每日挑战</text>
        <text class="menu-desc">今日统一网格 · 3次机会</text>
      </view>
      <view class="menu-item" @tap="onChapters">
        <text class="menu-icon">章</text>
        <text class="menu-label">单人闯关</text>
        <text class="menu-desc">章节地图 · 星级挑战</text>
      </view>
      <view class="menu-item" @tap="onBattle">
        <text class="menu-icon battle">战</text>
        <text class="menu-label">实时对战</text>
        <text class="menu-desc">同网格 1v1 · 实时比拼（AI兜底）</text>
      </view>
      <view class="menu-item" @tap="onBattle4p">
        <text class="menu-icon battle4p">混</text>
        <text class="menu-label">4人混战</text>
        <text class="menu-desc">4人同网格 · 实时排名（AI补位）</text>
      </view>
      <view class="menu-item" @tap="onRank">
        <text class="menu-icon rank">段</text>
        <text class="menu-label">段位赛</text>
        <text class="menu-desc">赛季段位 · 升降冲刺</text>
      </view>
      <view class="menu-item" @tap="onPokedex">
        <text class="menu-icon pokedex">鉴</text>
        <text class="menu-label">词库图鉴</text>
        <text class="menu-desc">收集你找到的词</text>
      </view>
      <view class="menu-item" @tap="onLeaderboard">
        <text class="menu-icon leaderboard">榜</text>
        <text class="menu-label">排行榜</text>
        <text class="menu-desc">每日 / 赛季 / 总榜</text>
      </view>
      <view class="menu-item" @tap="onChallengeRecords">
        <text class="menu-icon challenge">邀</text>
        <text class="menu-label">我的挑战</text>
        <text class="menu-desc">好友挑战记录</text>
      </view>
      <view class="menu-item" @tap="onInventory">
        <text class="menu-icon">包</text>
        <text class="menu-label">背包</text>
        <text class="menu-desc">道具库存</text>
      </view>
      <view class="menu-item" @tap="onAchievement">
        <text class="menu-icon">成</text>
        <text class="menu-label">成就</text>
        <text class="menu-desc">解锁称号与奖励</text>
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
.menu-icon.battle4p { background: #e67e22; }
.menu-icon.rank { background: #2980b9; }
.menu-icon.pokedex { background: #d4a017; }
.menu-icon.daily { background: #4caf50; }
.menu-icon.leaderboard { background: #8e44ad; }
.menu-icon.challenge { background: #ff7043; }
.daily-item { border-color: #a5d6a7; background: #f1f8e9; }
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
.economy-bar {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  margin-top: 24rpx;
  background: #fff;
  border: 2rpx solid #d4c8b8;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
}
.eco-item { font-size: 24rpx; color: #3a2e2e; }
.eco-item.rank { color: #2980b9; font-weight: bold; }
</style>
