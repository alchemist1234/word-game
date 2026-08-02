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

// 潜在词池覆盖率（对齐迭代3详细设计 §7）
const coveragePercent = computed(() => {
  if (store.potentialCount <= 0) return null
  return Math.round((store.foundWords.length / store.potentialCount) * 100)
})

function playAgain() {
  if (store.levelMode && store.levelId) {
    store.startLevel(store.levelId)
    uni.redirectTo({ url: `/pages/Game/index?levelId=${store.levelId}` })
  } else {
    store.startGame()
    uni.redirectTo({ url: '/pages/Game/index' })
  }
}

function goNextLevel() {
  if (store.nextLevelId) {
    store.startLevel(store.nextLevelId)
    uni.redirectTo({ url: `/pages/Game/index?levelId=${store.nextLevelId}` })
  }
}

function goHome() {
  store.restart()
  uni.reLaunch({ url: '/pages/Chapters/index' })
}
</script>

<template>
  <view class="result">
    <text class="title">{{ store.levelMode ? store.levelTitle : '本局结束' }}</text>
    <view v-if="store.levelMode" class="stars-display">
      <text :class="store.lastStars >= 1 ? 'star-active' : 'star-inactive'">★</text>
      <text :class="store.lastStars >= 2 ? 'star-active' : 'star-inactive'">★</text>
      <text :class="store.lastStars >= 3 ? 'star-active' : 'star-inactive'">★</text>
    </view>
    <view class="score-wrap">
      <text class="total-score">{{ store.score }}</text>
      <text class="score-unit">分</text>
    </view>
    <view v-if="store.perfect" class="perfect-badge">
      <text>完美通关 +{{ store.perfectBonus }}</text>
    </view>
    <view class="stats">
      <text class="stat">找到 {{ store.foundWords.length }} 个词</text>
      <text class="stat">含 {{ idiomCount }} 个成语</text>
      <text class="stat">最高连击 ×{{ store.maxCombo }}</text>
    </view>

    <view v-if="store.comboScore > 0" class="combo-score">
      <text>连击得分 +{{ store.comboScore }}</text>
    </view>

    <view v-if="coveragePercent !== null" class="coverage">
      <text class="coverage-text">
        本局可形成 {{ store.potentialCount }} 个词，你找到了 {{ store.foundWords.length }} 个（{{ coveragePercent }}%）
      </text>
      <view class="coverage-track">
        <view class="coverage-fill" :style="{ width: coveragePercent + '%' }" />
      </view>
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

    <view v-if="store.unfoundWords.length > 0" class="unfound-section">
      <text class="unfound-title">本局未找到的词（{{ store.unfoundWords.length }} 个）</text>
      <scroll-view scroll-y class="unfound-list">
        <view class="unfound-tags">
          <text
            v-for="uw in store.unfoundWords"
            :key="uw.word"
            class="unfound-tag"
            :class="'tag-' + uw.rarity"
          >{{ uw.word }}</text>
        </view>
      </scroll-view>
    </view>

    <view class="actions">
      <button v-if="store.canNext && store.nextLevelId" class="btn-next" @tap="goNextLevel">下一关</button>
      <button class="btn-primary" @tap="playAgain">再来一局</button>
      <button class="btn-secondary" @tap="goHome">返回章节</button>
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
.stars-display {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 16rpx;
  margin: 16rpx 0;
}
.star-active {
  font-size: 72rpx;
  color: #d4a017;
}
.star-inactive {
  font-size: 72rpx;
  color: #d4c8b8;
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
.perfect-badge {
  padding: 12rpx 32rpx;
  background: #d4a017;
  border-radius: 40rpx;
  margin-bottom: 16rpx;
}
.perfect-badge text {
  font-size: 30rpx;
  font-weight: bold;
  color: #ffffff;
}
.stats {
  display: flex;
  flex-direction: row;
  gap: 32rpx;
  margin-bottom: 24rpx;
}
.stat {
  font-size: 26rpx;
  color: #6a5a4a;
}
.combo-score {
  font-size: 26rpx;
  color: #d97a1e;
  font-weight: bold;
  margin-bottom: 16rpx;
}
.coverage {
  width: 100%;
  margin-bottom: 24rpx;
}
.coverage-text {
  font-size: 24rpx;
  color: #8a7a6a;
}
.coverage-track {
  height: 12rpx;
  background: #e8e0d0;
  border-radius: 6rpx;
  margin-top: 8rpx;
  overflow: hidden;
}
.coverage-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  border-radius: 6rpx;
}
.word-list {
  width: 100%;
  flex: 1;
  max-height: 560rpx;
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
.unfound-section {
  width: 100%;
  margin-top: 16rpx;
}
.unfound-title {
  font-size: 24rpx;
  color: #b0a090;
  display: block;
  margin-bottom: 8rpx;
}
.unfound-list {
  max-height: 180rpx;
}
.unfound-tags {
  display: flex;
  flex-wrap: wrap;
}
.unfound-tag {
  font-size: 22rpx;
  line-height: 1.2;
  padding: 4rpx 12rpx;
  margin: 4rpx;
  border: 1rpx solid;
  border-radius: 8rpx;
  background: #f0ece4;
  opacity: 0.75; /* 未找到：淡化显示 */
}
.tag-idiom {
  color: #b8860b;
  border-color: #d4a017;
}
.tag-rare {
  color: #8e44ad;
  border-color: #8e44ad;
}
.tag-normal {
  color: #4a90d9;
  border-color: #4a90d9;
}
.tag-common {
  color: #6a5a4a;
  border-color: #b0a090;
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
.btn-secondary::after,
.btn-next::after {
  border: none;
}
.btn-next {
  flex: 1;
  background: #d4a017;
  color: #ffffff;
  font-size: 32rpx;
  border-radius: 48rpx;
  border: none;
}
</style>
