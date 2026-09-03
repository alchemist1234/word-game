<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchPokedex, fetchPokedexTitles, type PokedexResponse } from '../../api'

const RARITY_MAP: Record<string, string> = { common: '常见', normal: '一般', rare: '罕见', idiom: '成语' }
function rarityLabel(r: string): string { return RARITY_MAP[r] ?? r }
function groupLabel(k: string): string { return RARITY_MAP[k] ?? k }

const data = ref<PokedexResponse | null>(null)
const loading = ref(true)
const groupBy = ref<'rarity' | 'length' | 'tag'>('rarity')
const titles = ref<Array<{ threshold: number; title: string; unlocked: boolean }>>([])
const collected = ref(0)

async function load() {
  loading.value = true
  try {
    data.value = await fetchPokedex(groupBy.value ? { groupBy: groupBy.value } : undefined)
    const t = await fetchPokedexTitles()
    titles.value = t.titles
    collected.value = t.collected
  } catch (e) {
    console.error('fetchPokedex', e)
  } finally {
    loading.value = false
  }
}

function switchGroup(g: 'rarity' | 'length' | 'tag') {
  groupBy.value = g
  load()
}

onShow(load)
</script>

<template>
  <view class="pokedex">
    <view class="stats">
      <text class="count">已收集 {{ data?.collected ?? 0 }} / {{ data?.total ?? 0 }}</text>
      <view class="titles">
        <text v-for="t in titles" :key="t.threshold" class="title-badge" :class="{ unlocked: t.unlocked }">{{ t.title }}({{ t.threshold }})</text>
      </view>
    </view>
    <view class="tabs">
      <text class="tab" :class="{ active: groupBy === 'rarity' }" @tap="switchGroup('rarity')">稀有度</text>
      <text class="tab" :class="{ active: groupBy === 'length' }" @tap="switchGroup('length')">字数</text>
      <text class="tab" :class="{ active: groupBy === 'tag' }" @tap="switchGroup('tag')">主题</text>
    </view>
    <scroll-view v-if="!loading" scroll-y class="word-list">
      <template v-if="data?.groups">
        <view v-for="g in data.groups" :key="g.key" class="group">
          <text class="group-key">{{ groupBy === 'rarity' ? groupLabel(g.key) : g.key }} ({{ g.count }})</text>
          <view class="words-grid">
            <view v-for="w in g.words" :key="w.word" class="word-tag" :class="'rarity-' + w.rarity">
              <text class="word">{{ w.word }}</text>
            </view>
          </view>
        </view>
      </template>
      <template v-else>
        <view class="words-grid">
          <view v-for="w in data?.words" :key="w.word" class="word-tag" :class="'rarity-' + w.rarity">
            <text class="word">{{ w.word }}</text>
          </view>
        </view>
      </template>
      <view v-if="(data?.words.length ?? 0) === 0" class="empty">
        <text>还没有收集到任何词，去闯关吧！</text>
      </view>
    </scroll-view>
    <view v-else class="loading">加载中...</view>
  </view>
</template>

<style scoped>
.pokedex { display: flex; flex-direction: column; min-height: 100vh; background: #f5f0e8; width: 100%; box-sizing: border-box; overflow-x: hidden; }
.stats { padding: 24rpx 32rpx; box-sizing: border-box; width: 100%; }
.count { font-size: 30rpx; color: #3a2e2e; font-weight: bold; }
.titles { margin-top: 12rpx; display: flex; flex-wrap: wrap; gap: 12rpx; }
.title-badge { font-size: 20rpx; padding: 6rpx 12rpx; border-radius: 8rpx; background: #e0d8c8; color: #8a7a6a; }
.title-badge.unlocked { background: #d4a017; color: #fff; }
.tabs { display: flex; flex-direction: row; padding: 0 32rpx; gap: 24rpx; border-bottom: 1rpx solid #e0d8c8; box-sizing: border-box; width: 100%; }
.tab { padding: 16rpx 0; font-size: 26rpx; color: #8a7a6a; }
.tab.active { color: #3a2e2e; font-weight: bold; border-bottom: 4rpx solid #d4a017; }
.word-list { flex: 1; padding: 0 32rpx 40rpx; box-sizing: border-box; width: 100%; }
.group { margin-top: 20rpx; width: 100%; box-sizing: border-box; }
.group-key { font-size: 26rpx; font-weight: bold; color: #3a2e2e; margin-bottom: 12rpx; display: block; }
.words-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12rpx; width: 100%; box-sizing: border-box; }
.word-tag { display: flex; align-items: center; justify-content: center; padding: 16rpx 4rpx; background: #ffffff; border-radius: 12rpx; border: 1rpx solid #d4c8b8; border-left: 6rpx solid #d4c8b8; box-sizing: border-box; min-width: 0; }
.word-tag.rarity-idiom { border-left-color: #d4a017; background: #fffbeb; }
.word-tag.rarity-rare { border-left-color: #8e44ad; }
.word-tag.rarity-normal { border-left-color: #4a90d9; }
.word { font-size: 28rpx; font-weight: bold; color: #3a2e2e; }
.rarity-idiom .word { color: #b8860b; }
.empty { text-align: center; padding: 80rpx; color: #b0a090; }
.loading { text-align: center; padding: 80rpx; color: #b0a090; }
</style>
