<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { fetchItems, fetchInventory, fetchEconomy, purchaseItem, type ItemConfig } from '../../api'

const MODE_MAP: Record<string, string> = {
  level: '闯关',
  friend: '好友挑战',
  pvp_1v1: '1v1对战',
  pvp_4p: '4人混战',
  daily: '每日挑战',
  free: '自由',
}

const items = ref<ItemConfig[]>([])
const inventory = ref<Map<string, number>>(new Map())
const economy = ref<{ coins: number; diamonds: number } | null>(null)

async function load() {
  const [a, b, c] = await Promise.all([fetchItems(), fetchInventory(), fetchEconomy().catch(() => null)])
  items.value = a.items
  inventory.value = new Map(b.items.map((i) => [i.itemId, i.quantity]))
  if (c) economy.value = { coins: c.coins, diamonds: c.diamonds }
}

function modeText(modes: string[]): string {
  return modes.map((m) => MODE_MAP[m] ?? m).join('、')
}

function qty(id: string): number {
  return inventory.value.get(id) ?? 0
}

async function onBuy(it: ItemConfig) {
  const costLabel = `${it.costType === 'coins' ? '金币' : '钻石'}×${it.cost}`
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: `确认购买 ${it.name}？`,
      content: `将消耗 ${costLabel}，购买后持有数量+1`,
      confirmText: '确认购买',
      cancelText: '取消',
      success: (r) => resolve(!!r.confirm),
    })
  })
  if (!ok) return
  try {
    await purchaseItem(it.id, 1)
    uni.showToast({ title: '购买成功', icon: 'success' })
    await load()
  } catch (e: any) {
    uni.showToast({ title: e?.message || '购买失败', icon: 'none' })
  }
}

onShow(load)
</script>

<template>
  <view class="inventory">
    <view v-if="economy" class="economy-bar">
      <text class="eco">🪙 {{ economy.coins }}</text>
      <text class="eco">💎 {{ economy.diamonds }}</text>
    </view>
    <view v-for="it in items" :key="it.id" class="card">
      <view class="card-header">
        <text class="name">{{ it.name }}</text>
        <text class="qty-badge">持有 {{ qty(it.id) }}</text>
      </view>
      <view class="card-desc">
        <text class="desc">{{ it.desc }}</text>
        <text class="limit">·每关限{{ it.maxPerLevel }}次</text>
        <text v-if="it.bossOnly" class="boss-tag">·仅Boss关</text>
      </view>
      <view class="card-modes">
        <text class="modes">可用：{{ modeText(it.allowedModes) }}</text>
      </view>
      <view class="card-footer">
        <view class="price">
          <text class="price-text">{{ it.costType === 'coins' ? '🪙' : '💎' }} {{ it.cost }}</text>
        </view>
        <view class="buy-btn" @tap="onBuy(it)">
          <text class="buy-text">购买</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.inventory { padding: 32rpx; background: #f5f0e8; min-height: 100vh; }
.economy-bar { display: flex; flex-direction: row; justify-content: flex-end; gap: 16rpx; margin-bottom: 16rpx; }
.eco { background: #fff; border: 1rpx solid #d4c8b8; border-radius: 20rpx; padding: 8rpx 16rpx; font-size: 24rpx; color: #3a2e2e; }
.card { background: #fff; border-radius: 16rpx; padding: 28rpx; margin-bottom: 20rpx; border: 1rpx solid #e8e0d0; }
.card-header { display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
.name { font-size: 32rpx; font-weight: bold; color: #3a2e2e; }
.qty-badge { background: #fff4b0; color: #b8860b; border: 1rpx solid #d4a017; border-radius: 20rpx; padding: 4rpx 14rpx; font-size: 22rpx; }
.card-desc { margin-top: 12rpx; display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8rpx; }
.desc { font-size: 24rpx; color: #6b5d4f; }
.limit { font-size: 22rpx; color: #8a7a6a; }
.boss-tag { font-size: 22rpx; color: #d94a4a; }
.card-modes { margin-top: 10rpx; }
.modes { font-size: 22rpx; color: #8a7a6a; }
.card-footer { margin-top: 18rpx; display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
.price { display: flex; flex-direction: row; align-items: center; }
.price-text { font-size: 28rpx; font-weight: bold; color: #3a2e2e; }
.buy-btn { background: #4a90d9; border-radius: 20rpx; padding: 10rpx 28rpx; }
.buy-text { color: #fff; font-size: 24rpx; font-weight: bold; }
</style>
