<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { onShow, onBackPress, onUnload } from '@dcloudio/uni-app'
import { useGameStore } from '../../store/game'
import GridBoard from '../../components/GridBoard.vue'
import type { CellPos } from '../../core/types'
import { playSuccess, playIdiom, playFail, playCombo } from '../../utils/sound'
import { fetchItems, useItem, type ItemConfig, startDailyRequest, startChallengeRequest, fetchInventory, fetchEconomy, applyWord } from '../../api'

const store = useGameStore()
const itemConfigs = ref<ItemConfig[]>([])
const hintCell = ref<{ row: number; col: number } | null>(null)
const hintChar = ref<string | null>(null)
let freezeTimer: ReturnType<typeof setTimeout> | null = null
const freezeLeft = ref(0)
const inventoryMap = ref<Map<string, number>>(new Map())
const economyInfo = ref<{ coins: number; diamonds: number } | null>(null)
const usageMap = ref<Map<string, number>>(new Map())

const levelItems = computed(() => itemConfigs.value.filter((it) => it.allowedModes.includes('level')))

// 迭代9-1：未收录词一键申请（仅 not_in_dict，对战中不打扰）
const applying = ref(false)
const applyHint = ref('')
const showApplyEntry = computed(
  () =>
    store.lastFailReason === 'not_in_dict' &&
    !!store.lastFailWord &&
    store.isInvalidListed(store.lastFailWord) &&
    !store.matchMode &&
    !store.battle4pMode,
)
watch(
  () => store.lastFailWord,
  () => {
    applyHint.value = ''
  },
)
async function onApplyWord() {
  const word = store.lastFailWord
  if (!word || applying.value || store.hasWordApplied(word)) return
  const attempt = store.invalidAttempts.find((a) => a.word === word)
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: `申请收录“${word}”？`,
      content: '多人申请后将加入词库，本局不加分',
      confirmText: '提交申请',
      cancelText: '取消',
      success: (r) => resolve(!!r.confirm),
    })
  })
  if (!confirmed) return
  applying.value = true
  try {
    const res = await applyWord(word, store.matchSessionId || undefined, attempt?.cells)
    store.markWordApplied(word)
    if (res.inDict) applyHint.value = '已收录，新开对局可用'
    else if (res.autoMerged) applyHint.value = '已加入词库，新开对局可用'
    else applyHint.value = `已申请 ${res.supporters}/${res.threshold}`
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '提交失败', icon: 'none' })
  } finally {
    applying.value = false
  }
}

function isItemDisabled(it: ItemConfig): boolean {
  const used = usageMap.value.get(it.id) ?? 0
  if (used >= it.maxPerLevel) return true
  if (it.bossOnly && !store.isBossLevel) return true
  // 道具是否可用：库存>0 或 金币/钻石足以支付单次成本
  const qty = inventoryMap.value.get(it.id) ?? 0
  if (qty > 0) return false
  if (!economyInfo.value) return false // 未加载完成前不置灰
  if (it.costType === 'coins') return (economyInfo.value.coins ?? 0) < it.cost
  return (economyInfo.value.diamonds ?? 0) < it.cost
}

function itemQty(it: ItemConfig): number {
  return inventoryMap.value.get(it.id) ?? 0
}

async function loadItems() {
  try {
    const res = await fetchItems()
    itemConfigs.value = res.items
  } catch {}
  try {
    const inv = await fetchInventory()
    inventoryMap.value = new Map(inv.items.map((i) => [i.itemId, i.quantity]))
  } catch {}
  try {
    const eco = await fetchEconomy()
    economyInfo.value = { coins: eco.coins, diamonds: eco.diamonds }
  } catch {}
}

onShow(() => {
  loadItems()
  usageMap.value = new Map()
})

async function onUseItem(itemId: string) {
  const cfg = itemConfigs.value.find((i) => i.id === itemId)
  if (cfg && isItemDisabled(cfg)) {
    uni.showToast({ title: '道具不可用', icon: 'none' })
    return
  }
  if (!store.matchSessionId) return
  try {
    const result = await useItem(store.matchSessionId, itemId)
    // 更新本地使用计数与经济/库存（用于置灰与角标）
    usageMap.value.set(itemId, (usageMap.value.get(itemId) ?? 0) + 1)
    // 刷新库存与经济（角标与可购买判断）
    fetchInventory().then((inv) => { inventoryMap.value = new Map(inv.items.map((i) => [i.itemId, i.quantity])) }).catch(() => {})
    fetchEconomy().then((eco) => { economyInfo.value = { coins: eco.coins, diamonds: eco.diamonds } }).catch(() => {})
    if (itemId === 'hint' && result.hintCell) {
      const c = result.hintCell as { row: number; col: number }
      hintCell.value = c
      // 上方显示对应字（hintWord 首字或格子字），常驻直至该字开头的词被找到
      const hw = result.hintWord as string | undefined
      if (hw) hintChar.value = hw[0]
      else if (store.grid[c.row]?.[c.col]) hintChar.value = store.grid[c.row][c.col]
      else hintChar.value = null
    }
    if (itemId === 'freeze' && result.freezeUntil) {
      const until = Number(result.freezeUntil)
      const seconds = (result.seconds as number) ?? 10
      store.setFreeze(seconds)
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000))
      freezeLeft.value = left
      if (freezeTimer) clearInterval(freezeTimer)
      freezeTimer = setInterval(() => {
        const l = Math.max(0, Math.ceil((until - Date.now()) / 1000))
        freezeLeft.value = l
        if (l <= 0 && freezeTimer) { clearInterval(freezeTimer); freezeTimer = null }
      }, 1000)
    }
    if (itemId === 'double') {
      uni.showToast({ title: '下一词双倍', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '使用失败', icon: 'none' })
  }
}

// 提示常驻：该字开头的词被找到后自动清除提示
watch(
  () => store.foundWords.map((w) => w.word).join(','),
  () => {
    if (!hintChar.value || !hintCell.value) return
    const target = hintChar.value
    if (store.foundWords.some((w) => w.word[0] === target)) {
      hintCell.value = null
      hintChar.value = null
    }
  },
)
// shuffle 换网格时清除提示（旧坐标失效）
watch(
  () => store.grid,
  () => {
    // 仅当 grid 引用变化且是 shuffle 触发时，已在 onUseItem 中清空 foundWords，此处同步清提示
    // 若仍需保留提示则不清除，这里选择清除以防错位
    if (hintCell.value) {
      // 检查提示坐标是否仍对应原字，否则清除
      const c = hintCell.value
      if (!store.grid[c.row]?.[c.col] || store.grid[c.row][c.col] !== hintChar.value) {
        hintCell.value = null
        hintChar.value = null
      }
    }
  },
)

// 进入页面确保对局进行中（支持 闯关/每日/好友 参数）
onShow(async () => {
  if (store.phase === 'playing') return
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1] as
    | { options?: { levelId?: string; challengeId?: string; daily?: string } }
    | undefined
  const opts = currentPage?.options
  if (opts?.levelId) {
    store.startLevel(opts.levelId)
  } else if (opts?.challengeId) {
    // 刷新后 store 丢失，重新拉取同 challenge 网格（同网格，同日不重建）
    try {
      const res = await startChallengeRequest(opts.challengeId)
      store.startChallenge({ matchSessionId: res.matchSessionId, grid: res.grid, duration: res.duration, challengeId: opts.challengeId, challenger: res.challenger })
    } catch {
      store.startGame()
    }
  } else if (opts?.daily) {
    // 日常挑战：同日同一网格，刷新后重新 startDaily 获取同网格（后端 ensureToday 保证同网格）
    try {
      const res = await startDailyRequest()
      store.startDaily(res)
    } catch {
      store.startGame()
    }
  } else {
    store.startGame()
  }
})

// 拦截返回：对局进行中弹窗确认，确认后结束对局并结算
onBackPress(() => {
  if (store.phase === 'playing') {
    uni.showModal({
      title: '结束当前对局',
      content: '确定要结束当前对局并结算吗？',
      confirmText: '结算',
      cancelText: '继续游戏',
      success: (res) => {
        if (res.confirm) {
          store.endGame()
        }
      },
    })
    return true // 阻止默认返回
  }
  return false
})

// 页面销毁：清理对局（未结算时重置，防止再次进入残留旧对局）
onUnload(() => {
  store.abandon()
})

// 结束 -> 跳结算页
watch(
  () => store.phase,
  (p) => {
    if (p === 'finished') {
      uni.redirectTo({ url: '/pages/Result/index' })
    }
  },
)

// GridBoard 事件代理到 store
function onSelect(cell: CellPos) {
  store.selectCell(cell)
}
function onRetreat() {
  store.retreat()
}
function onSubmit() {
  store.submitSelection()
}
function onClear() {
  store.clearSelection()
}

// 已找到词的格子集合（轻微高亮）
const foundCells = computed(() => {
  const set = new Set<string>()
  for (const fw of store.foundWords) {
    for (const c of fw.cells) set.add(`${c.row},${c.col}`)
  }
  return set
})

const grid = computed(() => store.grid)

// 已找到词按稀有度从高到低排序（idiom > rare > normal > common）
const RARITY_ORDER: Record<string, number> = {
  idiom: 0,
  rare: 1,
  normal: 2,
  common: 3,
}
const sortedFoundWords = computed(() =>
  [...store.foundWords].sort(
    (a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9),
  ),
)

// 倒计时 mm:ss
const timeText = computed(() => {
  const m = Math.floor(store.timeLeft / 60)
  const s = store.timeLeft % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const isLowTime = computed(() => store.timeLeft <= 30)

// 关卡目标文案（含specificWord中文要求+实时进度+3星线，与后端calcThresholds同口径）
function star3(goal: number): number {
  return Math.max(goal + 1, Math.round(goal * 1.5))
}
const objectiveText = computed(() => {
  if (!store.levelMode || !store.objective) return ''
  const o = store.objective
  if (o.type === 'specificWord') {
    const n = store.foundWords.filter((w) => w.word.includes(o.char ?? '')).length
    return `找到${o.target ?? 0}个包含“${o.char ?? ''}”字的词语（${n}/${o.target ?? 0}，3星需${star3(o.target ?? 0)}个）`
  }
  if (o.type === 'score') {
    return `目标 ${o.target ?? 0} 分（当前 ${store.score} 分，3星需 ${star3(o.target ?? 0)} 分）`
  }
  if (o.type === 'wordCount') {
    return `找到 ${o.target ?? 0} 个词（${store.foundWords.length}/${o.target ?? 0}，3星需${star3(o.target ?? 0)}个）`
  }
  if (o.type === 'idiom') {
    const n = store.foundWords.filter((w) => w.rarity === 'idiom').length
    return `找到 ${o.target ?? 0} 个成语（${n}/${o.target ?? 0}，3星需${star3(o.target ?? 0)}个）`
  }
  if (o.type === 'timeLimit') {
    return `限时得 ${o.score ?? 0} 分（当前 ${store.score} 分，3星需 ${star3(o.score ?? 0)} 分）`
  }
  return ''
})

// 连击倒计时（本地 UI 显示，服务端权威判定一致性）
const COMBO_WINDOW = 10000
const comboCountdownMs = ref(0)
let comboInterval: ReturnType<typeof setInterval> | null = null

const comboBarWidth = computed(
  () => `${Math.max(0, (comboCountdownMs.value / COMBO_WINDOW) * 100)}%`,
)

function startComboCountdown() {
  comboCountdownMs.value = COMBO_WINDOW
  if (comboInterval) clearInterval(comboInterval)
  comboInterval = setInterval(() => {
    // 冻结期间连击条暂停
    if (store.freezeUntil !== null && Date.now() < store.freezeUntil) return
    comboCountdownMs.value -= 100
    if (comboCountdownMs.value <= 0) {
      comboCountdownMs.value = 0
      if (comboInterval) {
        clearInterval(comboInterval)
        comboInterval = null
      }
    }
  }, 100)
}

onUnmounted(() => {
  if (comboInterval) clearInterval(comboInterval)
})

// 飘字与反馈：成功飘字（稀有度颜色）+ 失败震动 + 音效
const floatVisible = ref(false)
const failFlash = ref(false)
let floatTimer: ReturnType<typeof setTimeout> | null = null
let failTimer: ReturnType<typeof setTimeout> | null = null

const floatColorClass = computed(() => {
  if (store.lastFoundRarity === 'idiom') return 'float-idiom'
  if (store.lastFoundRarity === 'rare') return 'float-rare'
  if (store.lastFoundRarity === 'normal') return 'float-normal'
  return 'float-common'
})

watch(
  () => store.lastFeedback,
  (fb) => {
    if (!fb) return
    if (fb === 'success') {
      floatVisible.value = true
      if (store.lastFoundRarity === 'idiom') playIdiom()
      else playSuccess()
      if (store.combo >= 1) playCombo(store.combo)
      startComboCountdown()
      if (floatTimer) clearTimeout(floatTimer)
      floatTimer = setTimeout(() => {
        floatVisible.value = false
        store.clearFeedback()
      }, 800)
    } else if (fb === 'fail') {
      failFlash.value = true
      playFail()
      uni.vibrateShort({ type: 'light' })
      if (failTimer) clearTimeout(failTimer)
      failTimer = setTimeout(() => {
        failFlash.value = false
        store.clearFeedback()
      }, 350)
    } else if (fb === 'duplicate') {
      if (floatTimer) clearTimeout(floatTimer)
      floatTimer = setTimeout(() => store.clearFeedback(), 600)
    }
  },
)
</script>

<template>
  <view class="game" :class="{ 'game-fail': failFlash }">
    <view v-if="store.dailyMode" class="mode-banner daily-banner">
      <text>每日挑战 · {{ store.dailyDate }}</text>
    </view>
    <view v-if="store.challengeMode && store.challengeChallenger" class="mode-banner challenge-banner">
      <text>挑战 {{ store.challengeChallenger.nickname }} 的 {{ store.challengeChallenger.score }} 分</text>
    </view>
    <view class="topbar">
      <text class="timer" :class="{ 'timer-low': isLowTime }">{{ timeText }}</text>
      <text v-if="store.isBossLevel" class="boss-label">Boss</text>
      <text class="score">{{ store.score }}<text class="score-unit">分</text></text>
    </view>
    <view v-if="economyInfo" class="economy-mini">
      <text class="eco-mini">🪙 {{ economyInfo.coins }}</text>
      <text class="eco-mini">💎 {{ economyInfo.diamonds }}</text>
    </view>
    <view v-if="objectiveText" class="objective-banner">
      <text class="objective-text">{{ objectiveText }}</text>
    </view>

    <view v-if="store.levelMode" class="item-bar">
      <view
        v-for="it in levelItems"
        :key="it.id"
        class="item-btn"
        :class="{ 'item-btn-disabled': isItemDisabled(it) }"
        @tap="onUseItem(it.id)"
      >
        <text class="item-name">{{ it.name }}</text>
        <text v-if="itemQty(it) > 0" class="item-badge">{{ itemQty(it) }}</text>
      </view>
      <text v-if="freezeLeft > 0" class="freeze-hint">冻结 {{ freezeLeft }}s</text>
    </view>

    <view class="combo-bar" :class="{ 'combo-idle': store.combo === 0 }">
      <text v-if="store.combo > 0" class="combo-text">
        连击 ×{{ store.combo }}<text class="combo-mult">（本次 +{{ store.comboBonus }}分）</text>
      </text>
      <view class="combo-track">
        <view class="combo-fill" :style="{ width: comboBarWidth }" />
      </view>
    </view>

    <view class="current-word">
      <text v-if="store.currentWord" class="word-text">{{ store.currentWord }}</text>
      <text v-else class="word-placeholder">滑动连接相邻汉字</text>
    </view>

    <view class="apply-slot">
      <view v-if="showApplyEntry && store.lastFailWord" class="apply-entry">
        <text class="apply-text">“{{ store.lastFailWord }}”暂未收录</text>
        <view
          v-if="!store.hasWordApplied(store.lastFailWord)"
          class="apply-btn"
          @tap="onApplyWord"
        >
          <text class="apply-btn-text">{{ applying ? '提交中...' : '申请收录' }}</text>
        </view>
        <text v-else class="apply-done">{{ applyHint || '已申请' }}</text>
      </view>
    </view>

    <GridBoard
      v-if="grid.length > 0"
      :grid="grid"
      :selected-cells="store.selectedCells"
      :found-cells="foundCells"
      :hint-cell="hintCell"
      @select="onSelect"
      @retreat="onRetreat"
      @submit="onSubmit"
      @clear="onClear"
    />

    <view class="found-words">
      <text v-if="sortedFoundWords.length === 0" class="found-hint">
        已找到的词显示在这里
      </text>
      <text
        v-for="fw in sortedFoundWords"
        :key="fw.word"
        class="word-tag"
        :class="'tag-' + fw.rarity"
      >{{ fw.word }}</text>
    </view>

    <view class="float-score" :class="[floatColorClass, { 'float-show': floatVisible }]">
      <template v-if="store.lastFloatScore !== null">
        <text>+{{ store.lastFloatScore }}</text>
        <text v-if="store.comboBonus > 0" class="float-mult">+{{ store.comboBonus }}</text>
      </template>
    </view>
  </view>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 0;
  min-height: 100vh;
  background: #f5f0e8;
  transition: background 0.15s;
}
.game-fail {
  background: #f8d8d8;
}
.mode-banner {
  width: 620rpx;
  padding: 12rpx 16rpx;
  border-radius: 8rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: bold;
  margin-bottom: 12rpx;
}
.daily-banner { background: #e8f5e9; color: #2e7d32; border: 1rpx solid #a5d6a7; }
.challenge-banner { background: #fff3e0; color: #e65100; border: 1rpx solid #ffcc80; }
.topbar {
  width: 620rpx;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.timer {
  font-size: 48rpx;
  font-weight: bold;
  color: #3a2e2e;
  font-variant-numeric: tabular-nums;
}
.timer-low {
  color: #d94a4a;
}
.boss-label {
  font-size: 24rpx;
  color: #fff;
  background: #d94a4a;
  border-radius: 8rpx;
  padding: 4rpx 14rpx;
  font-weight: bold;
}
.score {
  font-size: 48rpx;
  font-weight: bold;
  color: #4a90d9;
}
.score-unit {
  font-size: 28rpx;
  color: #8a7a6a;
  margin-left: 8rpx;
}
.economy-mini {
  width: 620rpx;
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  gap: 16rpx;
  margin-bottom: 12rpx;
}
.eco-mini {
  font-size: 24rpx;
  color: #3a2e2e;
  background: #fff;
  border: 1rpx solid #d4c8b8;
  border-radius: 20rpx;
  padding: 4rpx 14rpx;
}
.objective-banner {
  width: 620rpx;
  background: #e8f0fe;
  border: 1rpx solid #4a90d9;
  border-radius: 8rpx;
  padding: 10rpx 16rpx;
  margin-bottom: 12rpx;
  text-align: center;
}
.objective-text {
  font-size: 24rpx;
  color: #2a70b9;
  font-weight: bold;
}
.combo-bar {
  width: 620rpx;
  height: 52rpx; /* 固定高度占位：连击条显隐不影响网格布局，避免 hitTest 错位 */
  margin-bottom: 8rpx;
  overflow: hidden;
}
.combo-idle {
  visibility: hidden; /* 无连击时内容隐藏但保留高度，网格位置稳定 */
}
.combo-text {
  display: block;
  font-size: 26rpx;
  line-height: 34rpx; /* 固定行高，防止文本溢出被 height/overflow 裁剪 */
  color: #d97a1e;
  font-weight: bold;
}
.combo-mult {
  font-size: 22rpx;
  color: #d97a1e;
}
.combo-track {
  height: 10rpx;
  background: #e8e0d0;
  border-radius: 5rpx;
  margin-top: 6rpx;
  overflow: hidden;
}
.combo-fill {
  height: 100%;
  background: linear-gradient(90deg, #d97a1e, #f0a030);
  border-radius: 5rpx;
  transition: width 0.1s linear;
}
.current-word {
  width: 620rpx;
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
}
.word-text {
  font-size: 44rpx;
  font-weight: bold;
  color: #3a2e2e;
  letter-spacing: 8rpx;
}
.word-placeholder {
  font-size: 28rpx;
  color: #b0a090;
}
.apply-slot {
  width: 620rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8rpx;
}
.apply-entry {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  background: #fffbeb;
  border: 1rpx solid #d4a017;
  border-radius: 24rpx;
  padding: 6rpx 12rpx 6rpx 20rpx;
}
.apply-text {
  font-size: 24rpx;
  color: #b8860b;
}
.apply-btn {
  background: #d4a017;
  border-radius: 20rpx;
  padding: 6rpx 20rpx;
}
.apply-btn-text {
  font-size: 24rpx;
  color: #fff;
  font-weight: bold;
}
.apply-done {
  font-size: 24rpx;
  color: #4caf50;
  font-weight: bold;
}
.float-score {
  position: fixed;
  top: 280rpx;
  font-size: 72rpx;
  font-weight: bold;
  color: #4caf50;
  opacity: 0;
  transform: translateY(20rpx);
  transition: opacity 0.2s, transform 0.2s;
  pointer-events: none;
}
.float-common {
  color: #4caf50;
}
.float-normal {
  color: #4a90d9;
}
.float-rare {
  color: #8e44ad;
}
.float-idiom {
  color: #d4a017;
}
.float-mult {
  font-size: 36rpx;
  margin-left: 8rpx;
}
.float-show {
  opacity: 1;
  transform: translateY(0);
}
.found-words {
  width: 620rpx;
  max-height: 150rpx;
  margin-top: 16rpx;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  overflow-y: auto;
}
.item-bar { width: 620rpx; display: flex; flex-direction: row; flex-wrap: wrap; gap: 12rpx; margin-bottom: 16rpx; align-items: center; }
.item-btn { position: relative; padding: 10rpx 16rpx; background: #fff; border: 1rpx solid #d4c8b8; border-radius: 8rpx; }
.item-btn-disabled { opacity: 0.4; background: #f0e8d8; }
.item-name { font-size: 24rpx; color: #3a2e2e; }
.item-badge { position: absolute; top: -12rpx; right: -12rpx; min-width: 32rpx; height: 32rpx; line-height: 32rpx; text-align: center; background: #d94a4a; color: #fff; font-size: 20rpx; border-radius: 16rpx; padding: 0 6rpx; }
.freeze-hint { font-size: 22rpx; color: #4a90d9; margin-left: 12rpx; }
.hint-banner { width: 620rpx; background: #fffbeb; border: 1rpx solid #d4a017; border-radius: 8rpx; padding: 10rpx 16rpx; margin-bottom: 16rpx; text-align: center; }
.hint-banner-text { font-size: 24rpx; color: #b8860b; font-weight: bold; }
.found-hint {
  font-size: 22rpx;
  color: #b0a090;
  padding: 8rpx 0;
}
.word-tag {
  font-size: 22rpx;
  line-height: 1.2;
  padding: 4rpx 12rpx;
  margin: 4rpx;
  border: 1rpx solid;
  border-radius: 8rpx;
  background: #ffffff;
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
</style>
