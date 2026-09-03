<script setup lang="ts">
import { ref, computed, onMounted, nextTick, getCurrentInstance } from 'vue'
import type { CellPos } from '../core/types'
import { hitCell } from '../core/gridHit'

/**
 * GridBoard 网格连线交互组件（对齐详细设计 §6/§7.4）
 * - 8 向相邻连线，支持回退（滑回倒数第二格）
 * - touch + mouse 双输入（移动端 + H5 PC 测试）
 * - 选中格高亮 + 序号 + 连线段
 */
interface Props {
  grid: string[][]
  selectedCells: CellPos[]
  /** 已找到词的格子 "row,col" 集合，轻微高亮 */
  foundCells: Set<string>
  /** 提示高亮格（方案B：2s 脉冲） */
  hintCell?: CellPos | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [cell: CellPos]
  retreat: []
  submit: []
  clear: []
}>()

interface BoardRect { left: number; top: number; width: number; height: number }

const size = computed(() => props.grid.length)
const boardRect = ref<BoardRect>({ left: 0, top: 0, width: 0, height: 0 })
// 实时校准值（非响应式：mousedown capture 中更新不触发重渲染中断）
let liveBoardRect = { left: 0, top: 0, width: 0, height: 0 }

// 测量网格位置（selectorQuery，跨端可靠）
function measureBoardPosition() {
  const instance = getCurrentInstance()
  const query = instance?.proxy
    ? uni.createSelectorQuery().in(instance.proxy)
    : uni.createSelectorQuery()
  query
    .select('.board')
    .boundingClientRect((rect: BoardRect | null) => {
      if (rect) {
        boardRect.value = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      }
    })
    .exec()
}

// mount + 延迟重测：避开页面切换动画导致的坐标偏移（"再来一局"错位）
onMounted(async () => {
  await nextTick()
  measureBoardPosition()
  setTimeout(measureBoardPosition, 300)
  setTimeout(measureBoardPosition, 600)
  // H5：网格位置校准（滚动/窗口 resize 后消除命中偏差）
  // - resize/scroll 监听更新响应式 boardRect（低频，事件外）
  // - 指针按下 capture 阶段更新非响应式 liveBoardRect（先于 Vue handler，不触发重渲染中断）
  // #ifdef H5
  // uni-app H5 的事件对象（normalizeMouseEvent/normalizeTouchEvent）会把 clientY 换算成
  // "页面显示区"坐标系——减去 getWindowTop()（= CSS var --window-top + safe-area-inset-top，
  // 默认导航栏时即导航栏高度）。而 getBoundingClientRect() 返回浏览器视口坐标。
  // 两者混用会让命中区域整体竖直偏移一个顶部窗口高度（点方格上半部分被识别成上方格）。
  // 因此实时测量矩形必须换算到与事件相同的坐标系：top 减同一偏移，left/x 不偏移。
  const getWindowTopOffset = () => {
    const style = document.documentElement.style
    const m = (style.getPropertyValue('--window-top').match(/\d+/) || ['0'])[0]
    const num = parseInt(m, 10)
    return Number.isFinite(num) && num > 0 ? num : 0
  }
  const readLiveRect = () => {
    const el = document.querySelector('.board')
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return null
    return {
      left: r.left,
      top: r.top - getWindowTopOffset(),
      width: r.width,
      height: r.height,
    }
  }
  // 实时 querySelector：组件重渲染可能替换 board 节点，缓存旧节点会导致校准失效
  const refreshBoardPos = () => {
    const rect = readLiveRect()
    if (rect) boardRect.value = rect
  }
  const refreshLivePos = () => {
    const rect = readLiveRect()
    if (rect) liveBoardRect = rect
  }
  // uni-view 自定义元素上的原生监听不可靠（uni-app 事件系统接管），改用 document capture
  // 事件传播：document(capture) → ... → board(bubble) → Vue handler，校准先于命中
  document.addEventListener('mousedown', refreshLivePos, true)
  document.addEventListener('touchstart', refreshLivePos, true)
  window.addEventListener('resize', refreshBoardPos)
  window.addEventListener('scroll', refreshBoardPos, true)
  // #endif
})

function hitTest(x: number, y: number): CellPos | null {
  // 行列分别按宽/高等分（core/gridHit 纯函数，已单测）：
  // board 非正方形（布局拉伸）时格子视觉行高 = height/size，
  // 用单一宽度 cs 算行索引会系统性偏差（点击行上半部分被算到上方格子）
  // 位置优先用指针按下时校准的 liveBoardRect（滚动/窗口 resize 后准确），未校准回退 boardRect
  const rect = liveBoardRect.width > 0 ? liveBoardRect : boardRect.value
  return hitCell(rect, size.value, x, y)
}

function sameCell(a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.col === b.col
}

// 8 方向扇区（atan2 角度顺序：右、右下、下、左下、左、左上、上、右上）
const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // 0  右
  [1, 1], // 1  右下
  [1, 0], // 2  下
  [1, -1], // 3  左下
  [0, -1], // 4  左
  [-1, -1], // 5  左上
  [-1, 0], // 6  上
  [-1, 1], // 7  右上
]

// 统一指针处理
function handleStart(x: number, y: number) {
  const cell = hitTest(x, y)
  if (!cell) return
  emit('clear')
  emit('select', cell)
}

/**
 * 命中 + 方向一致模型
 * 必须进入其他格子（hitTest 命中），且命中格方向与手指移动方向一致才选中。
 * 解决：未进入格子即选中、边界闪烁、斜向误触。
 */
function handleMove(x: number, y: number) {
  if (props.selectedCells.length === 0) return
  const cells = props.selectedCells
  const current = cells[cells.length - 1]
  // 行列分别按宽/高等分（与 hitTest 一致，board 非正方形时行中心准确）
  const useLive = liveBoardRect.width > 0
  const csW = (useLive ? liveBoardRect.width : boardRect.value.width) / size.value
  const csH = (useLive ? liveBoardRect.height : boardRect.value.height) / size.value
  if (csW <= 0 || csH <= 0) return
  const left = useLive ? liveBoardRect.left : boardRect.value.left
  const top = useLive ? liveBoardRect.top : boardRect.value.top

  // 1. 必须命中其他格子（进入方格才考虑）
  const hit = hitTest(x, y)
  if (!hit || sameCell(hit, current)) return

  // 2. 手指相对 current 中心的位移（用于方向判定）
  const cx = current.col * csW + csW / 2
  const cy = current.row * csH + csH / 2
  const dx = x - left - cx
  const dy = y - top - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < csW * 0.2) return // 位移太小，方向不可靠

  // 3. 方向一致性：命中格方向 == 手指移动方向
  const hitDirRow = Math.sign(hit.row - current.row)
  const hitDirCol = Math.sign(hit.col - current.col)
  const angle = Math.atan2(dy, dx)
  const a = (angle + Math.PI * 2) % (Math.PI * 2)
  const sector = Math.floor((a + Math.PI / 8) / (Math.PI / 4)) % 8
  const [moveDr, moveDc] = DIRS8[sector]
  if (hitDirRow !== moveDr || hitDirCol !== moveDc) return // 方向不一致，忽略

  // 4. 必须相邻（防跳格）
  if (Math.abs(hit.row - current.row) > 1 || Math.abs(hit.col - current.col) > 1) return

  // 5. 回退 / 已选 / 追加
  if (cells.length >= 2 && sameCell(hit, cells[cells.length - 2])) {
    emit('retreat')
    return
  }
  if (cells.some((c) => sameCell(c, hit))) return
  emit('select', hit)
}

function handleEnd() {
  emit('submit')
}

// touch 事件（移动端 + H5 触屏）
interface TouchLike {
  touches: Array<{ clientX: number; clientY: number }>
}
function onTouchStart(e: TouchLike) {
  const t = e.touches[0]
  if (t) handleStart(t.clientX, t.clientY)
}
function onTouchMove(e: TouchLike) {
  const t = e.touches[0]
  if (t) handleMove(t.clientX, t.clientY)
}
function onTouchEnd() {
  handleEnd()
}

// mouse 事件（H5 PC 测试）
interface MouseLike {
  clientX: number
  clientY: number
}
let mouseDown = false

// H5：全局 mouseup 监听，防止在 board 外松开丢失提交（修复已知技术债）
function onWindowMouseUp() {
  if (mouseDown) {
    handleEnd()
    mouseDown = false
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseup', onWindowMouseUp)
  }
}

function onMouseDown(e: MouseLike) {
  mouseDown = true
  handleStart(e.clientX, e.clientY)
  if (typeof window !== 'undefined') {
    window.addEventListener('mouseup', onWindowMouseUp)
  }
}
function onMouseMove(e: MouseLike) {
  if (mouseDown) handleMove(e.clientX, e.clientY)
}
function onMouseUp() {
  if (mouseDown) {
    handleEnd()
    mouseDown = false
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseup', onWindowMouseUp)
  }
}

function isSelected(row: number, col: number): boolean {
  return props.selectedCells.some((c) => c.row === row && c.col === col)
}
function selectedOrder(row: number, col: number): number {
  return props.selectedCells.findIndex((c) => c.row === row && c.col === col)
}
function isFound(row: number, col: number): boolean {
  return props.foundCells.has(`${row},${col}`)
}
function isHint(row: number, col: number): boolean {
  const h = props.hintCell
  return !!h && h.row === row && h.col === col
}

// 连线段（每对相邻选中格一条线）
interface LineSeg {
  left: number
  top: number
  width: number
  angle: number
}
const lines = computed<LineSeg[]>(() => {
  const useLive = liveBoardRect.width > 0
  const csW = (useLive ? liveBoardRect.width : boardRect.value.width) / size.value
  const csH = (useLive ? liveBoardRect.height : boardRect.value.height) / size.value
  if (csW <= 0 || csH <= 0 || props.selectedCells.length < 2) return []
  const result: LineSeg[] = []
  for (let i = 1; i < props.selectedCells.length; i++) {
    const a = props.selectedCells[i - 1]
    const b = props.selectedCells[i]
    const ax = a.col * csW + csW / 2
    const ay = a.row * csH + csH / 2
    const bx = b.col * csW + csW / 2
    const by = b.row * csH + csH / 2
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    result.push({ left: ax, top: ay, width: len, angle })
  }
  return result
})
</script>

<template>
  <view
    class="board"
    @touchstart.prevent="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <view v-for="(row, ri) in grid" :key="ri" class="row">
      <view
        v-for="(ch, ci) in row"
        :key="ci"
        class="cell"
        :class="{
          'cell-selected': isSelected(ri, ci),
          'cell-found': isFound(ri, ci) && !isSelected(ri, ci),
          'cell-hint': isHint(ri, ci) && !isSelected(ri, ci),
        }"
      >
        <text class="char">{{ ch }}</text>
        <text v-if="isSelected(ri, ci)" class="order">{{ selectedOrder(ri, ci) + 1 }}</text>
        <text v-if="isHint(ri, ci) && !isSelected(ri, ci)" class="hint-badge">💡</text>
        <view v-if="isHint(ri, ci) && !isSelected(ri, ci)" class="hint-ring" />
      </view>
    </view>
    <view class="lines-overlay">
      <view
        v-for="(ln, i) in lines"
        :key="i"
        class="line"
        :style="{
          left: ln.left + 'px',
          top: ln.top + 'px',
          width: ln.width + 'px',
          transform: 'rotate(' + ln.angle + 'deg)',
        }"
      />
    </view>
  </view>
</template>

<style scoped>
.board {
  position: relative;
  width: 620rpx;
  height: 620rpx;
  display: flex;
  flex-direction: column;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  overflow: visible;
}
.row {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: visible;
}
.cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1rpx solid #d4c8b8;
  background: #faf6ef;
  box-sizing: border-box;
  overflow: visible;
}
.cell-selected {
  background: #4a90d9;
  border-color: #2a70b9;
}
.cell-found {
  background: #e8f0e8;
}
.char {
  font-size: 52rpx;
  font-weight: bold;
  color: #3a2e2e;
}
.cell-selected .char {
  color: #ffffff;
}
.order {
  position: absolute;
  top: 4rpx;
  right: 8rpx;
  font-size: 22rpx;
  color: #ffffff;
  opacity: 0.85;
}
.lines-overlay {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.line {
  position: absolute;
  height: 8rpx;
  background: rgba(74, 144, 217, 0.55);
  transform-origin: 0 50%;
  border-radius: 4rpx;
}
.cell-hint {
  background: #fff4b0 !important;
  border-color: #d4a017 !important;
  border-width: 3rpx !important;
  animation: hint-pulse 0.9s ease-in-out infinite;
  z-index: 10;
  /* 提升层级避免右/下侧光晕被相邻格子覆盖（后渲染的兄弟格子会遮挡外扩的 ring） */
  position: relative;
}
.hint-badge {
  position: absolute;
  top: 4rpx;
  right: 6rpx;
  font-size: 20rpx;
  line-height: 1;
}
.hint-ring {
  position: absolute;
  left: -6rpx;
  top: -6rpx;
  right: -6rpx;
  bottom: -6rpx;
  border: 3rpx solid #d4a017;
  border-radius: 12rpx;
  pointer-events: none;
  animation: hint-ring 1.1s ease-out infinite;
  z-index: 11;
  /* 双层光晕确保四边可见 */
  box-shadow: 0 0 12rpx rgba(212, 160, 23, 0.45);
}
@keyframes hint-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
@keyframes hint-ring {
  0% { transform: scale(0.92); opacity: 0.9; }
  100% { transform: scale(1.12); opacity: 0; }
}
</style>
